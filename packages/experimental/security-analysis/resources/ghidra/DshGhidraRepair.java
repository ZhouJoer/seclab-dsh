// Explicit analysis corrections inside a DSH-owned Ghidra project.
// @category DSH
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Program;
import ghidra.program.model.pcode.PcodeOp;
import ghidra.program.model.symbol.Reference;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Runs selected repairs after auto-analysis and publishes their measured changes. */
public final class DshGhidraRepair extends HeadlessScript {
    private final Gson gson = new Gson();
    private static final Set<String> RETURNING_IMPORTS = Set.of("malloc", "memcpy", "memset", "strlen", "__tls_get_addr", "__errno_location");

    @Override
    public void run() throws Exception {
        try { repair(); }
        catch (Exception error) {
            setHeadlessContinuationOption(HeadlessContinuationOption.ABORT_AND_DELETE);
            throw error;
        }
    }

    private void repair() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Expected one DSH analysis profile");
        Path path = Path.of(args[0]);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 1048576)
            throw new IllegalArgumentException("DSH analysis profile must be a regular file below 1 MiB");
        JsonObject profile = gson.fromJson(Files.readString(path), JsonObject.class);
        if (!profile.get("format").getAsString().equals("dsh-ghidra-analysis-v1"))
            throw new IllegalArgumentException("Unsupported DSH analysis profile");
        if (currentProgram.getOptions(Program.PROGRAM_INFO).getString("DSH analysis preparation", null) == null)
            throw new IllegalStateException("The imported program has no successful DSH preparation report");
        if (analysisTimeoutOccurred()) throw new IllegalStateException("Ghidra analysis timed out before selected corrections");
        JsonObject settings = profile.getAsJsonObject("corrections"), report = new JsonObject();
        if (settings.get("noReturn").getAsBoolean()) report.add("noReturn", repairNoReturn());
        else report.addProperty("noReturn", "disabled");
        if (settings.get("mipsSoftFloat").getAsBoolean()) {
            correction(new DshGhidraMipsSoftFloat(), new String[0]);
            report.add("mipsSoftFloat", requireReport("DSH MIPS soft-float storage"));
        } else report.addProperty("mipsSoftFloat", "disabled");
        if (!settings.get("riscvAbi").isJsonNull()) {
            if (!settings.get("riscvAbi").getAsString().equals("ilp32")) throw new IllegalArgumentException("Unsupported RISC-V ABI policy");
            correction(new DshGhidraRiscvCallingConvention(), new String[] { "ilp32-prototype-v1" });
            report.add("riscvAbi", requireReport("DSH RISC-V calling convention"));
        } else report.addProperty("riscvAbi", "disabled");
        currentProgram.getOptions(Program.PROGRAM_INFO).setString("DSH analysis repairs", gson.toJson(report));
        enableHeadlessAnalysis(false);
        println("DSH analysis repairs: " + gson.toJson(report));
    }

    private void correction(GhidraScript script, String[] arguments) throws Exception {
        updateStateFromVariables();
        script.setScriptArgs(arguments);
        script.execute(state, getControls());
        loadVariablesFromState();
    }

    private JsonObject requireReport(String key) {
        String value = currentProgram.getOptions(Program.PROGRAM_INFO).getString(key, null);
        if (value == null) throw new IllegalStateException("Ghidra correction did not publish its completion report: " + key);
        return gson.fromJson(value, JsonObject.class);
    }

    private boolean decodedReturn(Function function) throws Exception {
        InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
        while (instructions.hasNext()) {
            monitor.checkCancelled();
            for (PcodeOp op : instructions.next().getPcode()) if (op.getOpcode() == PcodeOp.RETURN) return true;
        }
        return false;
    }

    private JsonObject repairNoReturn() throws Exception {
        Set<Address> cleared = new HashSet<>();
        ArrayDeque<Function> pending = new ArrayDeque<>();
        List<Function> functions = new ArrayList<>();
        currentProgram.getFunctionManager().getFunctions(true).forEach(functions::add);
        currentProgram.getFunctionManager().getExternalFunctions().forEach(functions::add);
        for (Function function : functions) {
            monitor.checkCancelled();
            if (!function.hasNoReturn()) continue;
            boolean returning = function.isExternal() ? RETURNING_IMPORTS.contains(function.getName()) : decodedReturn(function);
            if (returning) clear(function, cleared, pending);
        }
        int callSites = 0;
        Set<Address> refitted = new HashSet<>();
        while (!pending.isEmpty()) {
            Function target = pending.removeFirst();
            List<Address> sites = new ArrayList<>();
            for (Reference reference : currentProgram.getReferenceManager().getReferencesTo(target.getEntryPoint()))
                sites.add(reference.getFromAddress());
            for (Address at : sites) {
                monitor.checkCancelled();
                Instruction instruction = currentProgram.getListing().getInstructionAt(at);
                if (instruction == null || !instruction.getFlowType().isCall() || !instruction.getFlowType().isTerminal()) continue;
                boolean calls = false;
                for (Address destination : instruction.getFlows()) if (destination.equals(target.getEntryPoint())) calls = true;
                if (!calls) continue;
                Address next = instruction.getMaxAddress().next();
                if (next == null || !currentProgram.getMemory().contains(next) || getFunctionAt(next) != null) continue;
                Function caller = getFunctionContaining(at);
                clearListing(at, instruction.getMaxAddress());
                if (!disassemble(at)) throw new IllegalStateException("No-return correction could not decode its call site");
                callSites++;
                if (caller != null && !caller.isThunk()) {
                    CreateFunctionCmd.fixupFunctionBody(currentProgram, caller, monitor);
                    refitted.add(caller.getEntryPoint());
                    if (caller.hasNoReturn() && decodedReturn(caller)) clear(caller, cleared, pending);
                }
            }
        }
        JsonObject report = new JsonObject();
        report.addProperty("status", "applied");
        report.addProperty("clearedFunctions", cleared.size());
        report.addProperty("redisassembledCalls", callSites);
        report.addProperty("refittedFunctions", refitted.size());
        return report;
    }

    private void clear(Function function, Set<Address> cleared, ArrayDeque<Function> pending) throws Exception {
        function.setNoReturn(false);
        if (cleared.add(function.getEntryPoint())) pending.add(function);
        Address[] thunks = function.getFunctionThunkAddresses(true);
        if (thunks == null) return;
        for (Address address : thunks) {
            Function thunk = getFunctionAt(address);
            if (thunk != null && cleared.add(address)) pending.add(thunk);
        }
    }
}
