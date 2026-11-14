// Fixed read-only queries over the program imported by the DSH headless provider.
// @category DSH
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.framework.Application;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DshHeadless extends HeadlessScript {
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().serializeNulls().create();
    private final List<Map<String, Object>> items = new ArrayList<>();
    private int offset;
    private int limit;
    private int bytes;
    private int maximumBytes;
    private int matched;
    private boolean incomplete;
    private String filter;
    private DecompInterface decompiler;

    private Map<String, Object> record(Object... fields) {
        Map<String, Object> value = new LinkedHashMap<>();
        for (int index = 0; index < fields.length; index += 2) value.put((String) fields[index], fields[index + 1]);
        return value;
    }

    private String address(Address value) {
        if (value.getAddressSpace().equals(currentProgram.getAddressFactory().getDefaultAddressSpace()))
            return "0x" + Long.toUnsignedString(value.getAddressableWordOffset(), 16);
        return value.getAddressSpace().getName() + ":" + Long.toUnsignedString(value.getAddressableWordOffset(), 16);
    }

    private boolean add(Map<String, Object> value) throws Exception {
        monitor.checkCancelled();
        String text = gson.toJson(value);
        if (!filter.isEmpty() && !text.contains(filter)) return true;
        if (matched++ < offset) return true;
        int size = text.getBytes(StandardCharsets.UTF_8).length;
        if (items.size() >= limit || bytes + size > maximumBytes) {
            incomplete = true;
            return false;
        }
        items.add(value);
        bytes += size;
        return true;
    }

    private Map<String, Object> function(Function function) {
        return record("address", address(function.getEntryPoint()), "name", function.getName(),
            "signature", function.getPrototypeString(false, false), "size", function.getBody().getNumAddresses(),
            "external", function.isExternal(), "thunk", function.isThunk());
    }

    private Map<String, Object> reference(Reference reference) {
        return record("from", address(reference.getFromAddress()), "to", address(reference.getToAddress()),
            "type", reference.getReferenceType().toString(), "operandIndex", reference.getOperandIndex(),
            "primary", reference.isPrimary());
    }

    private Address target(JsonObject parameters) {
        if (!parameters.has("address")) throw new IllegalArgumentException("This operation requires an address");
        Address value = currentProgram.getAddressFactory().getAddress(parameters.get("address").getAsString());
        if (value == null) throw new IllegalArgumentException("Address is outside the program address spaces");
        return value;
    }

    private void query(String operation, JsonObject parameters, int decompileTimeoutSeconds) throws Exception {
        switch (operation) {
            case "identity":
                add(record("name", currentProgram.getName(), "sha256", currentProgram.getExecutableSHA256(),
                    "format", currentProgram.getExecutableFormat(), "language", currentProgram.getLanguageID().toString(),
                    "compiler", currentProgram.getCompilerSpec().getCompilerSpecID().toString(),
                    "imageBase", address(currentProgram.getImageBase()), "pointerSize", currentProgram.getDefaultPointerSize(),
                    "preparation", report("DSH analysis preparation"), "corrections", report("DSH analysis repairs"),
                    "mipsSoftFloat", report("DSH MIPS soft-float storage"), "riscvAbi", report("DSH RISC-V calling convention")));
                break;
            case "functions": {
                FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
                while (functions.hasNext()) if (!add(function(functions.next()))) break;
                break;
            }
            case "imports": {
                SymbolIterator symbols = currentProgram.getSymbolTable().getExternalSymbols();
                while (symbols.hasNext()) {
                    Symbol symbol = symbols.next();
                    if (!add(record("address", address(symbol.getAddress()), "name", symbol.getName(),
                        "namespace", symbol.getParentNamespace().getName(true), "type", symbol.getSymbolType().toString()))) break;
                }
                break;
            }
            case "exports": {
                AddressIterator addresses = currentProgram.getSymbolTable().getExternalEntryPointIterator();
                while (addresses.hasNext()) {
                    Address entry = addresses.next();
                    Symbol symbol = currentProgram.getSymbolTable().getPrimarySymbol(entry);
                    if (!add(record("address", address(entry), "name", symbol == null ? "" : symbol.getName()))) break;
                }
                break;
            }
            case "strings": {
                DataIterator data = currentProgram.getListing().getDefinedData(true);
                while (data.hasNext()) {
                    monitor.checkCancelled();
                    Data value = data.next();
                    if (value.hasStringValue() && !add(record("address", address(value.getAddress()),
                        "length", value.getLength(), "value", String.valueOf(value.getValue()), "type", value.getDataType().getName()))) break;
                }
                break;
            }
            case "decompile": {
                Function function = currentProgram.getFunctionManager().getFunctionAt(target(parameters));
                if (function == null) throw new IllegalArgumentException("No function begins at the requested address");
                try {
                    if (decompiler == null) {
                        decompiler = new DecompInterface();
                        if (!decompiler.openProgram(currentProgram)) throw new IllegalStateException(decompiler.getLastMessage());
                    }
                    DecompileResults result = decompiler.decompileFunction(function, decompileTimeoutSeconds, monitor);
                    if (result.isTimedOut())
                        throw new java.util.concurrent.TimeoutException("Ghidra decompilation exceeded " + decompileTimeoutSeconds + " seconds");
                    if (result.isCancelled()) throw new java.util.concurrent.CancellationException("Ghidra decompilation was cancelled");
                    if (!result.decompileCompleted() || result.getDecompiledFunction() == null)
                        throw new IllegalStateException("Decompilation did not complete: " + result.getErrorMessage());
                    add(record("address", address(function.getEntryPoint()), "name", function.getName(),
                        "code", result.getDecompiledFunction().getC()));
                } catch (Exception error) {
                    closeDecompiler();
                    throw error;
                }
                break;
            }
            case "disassemble": {
                Address target = target(parameters);
                if (currentProgram.getListing().getInstructionAt(target) == null)
                    throw new IllegalArgumentException("No instruction begins at the requested address");
                int count = parameters.get("count").getAsInt();
                limit = Math.min(limit, count);
                InstructionIterator instructions = currentProgram.getListing().getInstructions(target, true);
                while (instructions.hasNext()) {
                    Instruction instruction = instructions.next();
                    byte[] instructionBytes = instruction.getBytes();
                    StringBuilder hex = new StringBuilder();
                    for (byte value : instructionBytes) hex.append(String.format("%02x", value & 255));
                    if (!add(record("address", address(instruction.getAddress()), "length", instruction.getLength(),
                        "bytes", hex.toString(), "instruction", instruction.toString()))) break;
                }
                break;
            }
            case "xrefs-to": {
                ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(target(parameters));
                while (references.hasNext()) if (!add(reference(references.next()))) break;
                break;
            }
            case "xrefs-from":
                for (Reference reference : currentProgram.getReferenceManager().getReferencesFrom(target(parameters)))
                    if (!add(reference(reference))) break;
                break;
            default:
                throw new IllegalArgumentException("Unsupported Ghidra operation");
        }
    }

    private Object report(String key) {
        String value = currentProgram.getOptions(Program.PROGRAM_INFO).getString(key, null);
        return value == null ? null : gson.fromJson(value, JsonElement.class);
    }

    private void closeDecompiler() {
        if (decompiler != null) {
            decompiler.dispose();
            decompiler = null;
        }
    }

    private Map<String, Object> execute(JsonObject input) throws Exception {
        items.clear();
        bytes = 0;
        matched = 0;
        incomplete = false;
        String operation = input.get("operation").getAsString();
        String sha256 = input.get("inputSha256").getAsString();
        if (currentProgram == null || !sha256.equalsIgnoreCase(currentProgram.getExecutableSHA256()))
            throw new IllegalStateException("Ghidra program does not match the imported sample SHA-256");
        JsonObject parameters = input.getAsJsonObject("parameters");
        limit = Math.min(integer(input, "maxItems", 1), parameters.has("limit") ? integer(parameters, "limit", 1) : Integer.MAX_VALUE);
        offset = parameters.has("offset") ? integer(parameters, "offset", 0) : 0;
        filter = parameters.has("filter") ? parameters.get("filter").getAsString() : "";
        int resultBytes = integer(input, "maxBytes", 1024);
        maximumBytes = resultBytes;
        Map<String, Object> output = record("format", "dsh-ghidra-headless-v1", "operation", operation,
            "inputSha256", sha256, "ghidraVersion", Application.getApplicationVersion(),
            "token", input.get("token").getAsString(), "id", input.get("id").getAsString());
        try {
            query(operation, parameters, integer(input, "decompileTimeoutSeconds", 1));
            if (incomplete && items.isEmpty()) output.put("failure", "A Ghidra observation exceeds the byte limit; narrow the query or increase its output budget");
        } catch (Exception error) {
            incomplete = true;
            String message = error.getClass().getSimpleName() + ": " + error.getMessage();
            output.put("failure", message.substring(0, Math.min(message.length(), 256)));
        }
        output.put("items", items);
        output.put("analysisTimedOut", analysisTimeoutOccurred());
        output.put("incomplete", incomplete || analysisTimeoutOccurred());
        output.put("nextOffset", incomplete && !items.isEmpty() ? offset + items.size() : null);
        while (gson.toJson(output).getBytes(StandardCharsets.UTF_8).length > resultBytes && !items.isEmpty()) {
            items.remove(items.size() - 1);
            output.put("incomplete", true);
            output.put("nextOffset", items.isEmpty() ? null : offset + items.size());
            if (items.isEmpty()) output.put("failure", "A Ghidra observation exceeds the complete response byte limit");
        }
        if (gson.toJson(output).getBytes(StandardCharsets.UTF_8).length > resultBytes)
            throw new IllegalArgumentException("Ghidra response budget cannot hold its metadata");
        return output;
    }

    private int integer(JsonObject object, String key, int minimum) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber())
            throw new IllegalArgumentException(key + " must be an integer");
        int result = value.getAsBigDecimal().intValueExact();
        if (result < minimum) throw new IllegalArgumentException(key + " is below its minimum");
        return result;
    }

    private JsonObject read(Path path, int maximum) throws Exception {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > maximum)
            throw new IllegalArgumentException("Ghidra request must be a bounded regular file");
        byte[] bytes = Files.readAllBytes(path);
        if (bytes.length > maximum) throw new IllegalArgumentException("Ghidra request exceeded its byte limit");
        JsonObject value = gson.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
        if (value == null) throw new IllegalArgumentException("Ghidra request must be a JSON object");
        return value;
    }

    private void publish(Path path, Object value) throws Exception {
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        Files.writeString(temporary, gson.toJson(value), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE);
    }

    private void authenticate(JsonObject value, String token) {
        JsonElement supplied = value.get("token");
        if (supplied == null || !supplied.isJsonPrimitive() || !supplied.getAsJsonPrimitive().isString()
            || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), supplied.getAsString().getBytes(StandardCharsets.UTF_8)))
            throw new IllegalArgumentException("Ghidra session authentication failed");
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Expected the owned Ghidra session directory");
        Path directory = Path.of(args[0]);
        if (!directory.isAbsolute() || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))
            throw new IllegalArgumentException("Ghidra session directory must be an absolute regular directory");
        JsonObject config = read(directory.resolve("config.json"), 16384);
        if (!config.keySet().equals(Set.of("format", "token", "sessionId", "inputSha256", "maxRequestBytes", "pollIntervalMs"))
            || !config.get("format").getAsString().equals("dsh-ghidra-session-v1"))
            throw new IllegalArgumentException("Unsupported Ghidra session configuration");
        String token = config.get("token").getAsString(), sessionId = config.get("sessionId").getAsString();
        String sha256 = config.get("inputSha256").getAsString();
        if (!token.matches("[a-f0-9]{64}") || !sessionId.matches("[A-Za-z0-9-]{1,128}") || !sha256.matches("[a-f0-9]{64}"))
            throw new IllegalArgumentException("Invalid Ghidra session identity");
        int maximum = integer(config, "maxRequestBytes", 1024), interval = integer(config, "pollIntervalMs", 1);
        if (currentProgram == null || !sha256.equalsIgnoreCase(currentProgram.getExecutableSHA256()))
            throw new IllegalStateException("Ghidra program does not match the imported sample SHA-256");
        if (report("DSH analysis preparation") == null || report("DSH analysis repairs") == null)
            throw new IllegalStateException("Ghidra program has no completed DSH analysis preparation and correction reports");
        publish(directory.resolve("ready.json"), record("format", "dsh-ghidra-ready-v1", "token", token,
            "sessionId", sessionId, "inputSha256", sha256, "ghidraVersion", Application.getApplicationVersion(),
            "analysisTimedOut", analysisTimeoutOccurred()));
        if (analysisTimeoutOccurred()) return;
        try {
            while (true) {
                monitor.checkCancelled();
                Path close = directory.resolve("close.json"), request = directory.resolve("request.json");
                if (Files.exists(close, LinkOption.NOFOLLOW_LINKS)) {
                    authenticate(read(close, 1024), token);
                    return;
                }
                if (!Files.exists(request, LinkOption.NOFOLLOW_LINKS)) {
                    Thread.sleep(interval);
                    continue;
                }
                JsonObject value = read(request, maximum);
                authenticate(value, token);
                if (!value.keySet().equals(Set.of("token", "id", "operation", "inputSha256", "parameters",
                    "maxItems", "maxBytes", "decompileTimeoutSeconds"))
                    || !value.get("id").getAsString().matches("[A-Za-z0-9-]{1,128}"))
                    throw new IllegalArgumentException("Invalid Ghidra query envelope");
                Files.delete(request);
                publish(directory.resolve("response.json"), execute(value));
            }
        } finally { closeDecompiler(); }
    }
}
