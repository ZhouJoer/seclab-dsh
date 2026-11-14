// Import preparation for DSH-owned Ghidra projects.
// @category DSH
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import ghidra.app.plugin.core.analysis.AutoAnalysisManager;
import ghidra.app.services.Analyzer;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.program.database.mem.FileBytes;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.mem.MemoryBlockSourceInfo;
import ghidra.program.model.symbol.SourceType;
import ghidra.util.classfinder.ClassSearcher;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Applies a validated import profile before Ghidra auto-analysis; failures discard the owned import. */
public final class DshGhidraPrepare extends HeadlessScript {
    private final Gson gson = new Gson();

    @Override
    public void run() throws Exception {
        try { prepare(); }
        catch (Exception error) {
            setHeadlessContinuationOption(HeadlessContinuationOption.ABORT_AND_DELETE);
            throw error;
        }
    }

    private void prepare() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Expected one DSH analysis profile");
        Path path = Path.of(args[0]);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 1048576)
            throw new IllegalArgumentException("DSH analysis profile must be a regular file below 1 MiB");
        JsonObject profile = gson.fromJson(Files.readString(path), JsonObject.class);
        if (!profile.get("format").getAsString().equals("dsh-ghidra-analysis-v1"))
            throw new IllegalArgumentException("Unsupported DSH analysis profile");
        JsonObject imported = profile.getAsJsonObject("import");
        String format = imported.get("format").getAsString();
        switch (format) {
            case "auto": break;
            case "raw": prepareRaw(imported); break;
            case "dos-com": prepareCom(); break;
            case "gamecube-dol": prepareDol(profile.getAsJsonObject("dol")); break;
            default: throw new IllegalArgumentException("Unsupported Ghidra import format");
        }
        if (imported.has("languageId") && !imported.get("languageId").getAsString().equals(currentProgram.getLanguageID().getIdAsString()))
            throw new IllegalArgumentException("Imported Ghidra language differs from the selected profile");
        if (imported.has("compilerSpecId") && !imported.get("compilerSpecId").getAsString().equals(currentProgram.getCompilerSpec().getCompilerSpecID().getIdAsString()))
            throw new IllegalArgumentException("Imported Ghidra compiler specification differs from the selected profile");
        JsonObject report = new JsonObject();
        report.addProperty("importFormat", format);
        report.addProperty("languageId", currentProgram.getLanguageID().getIdAsString());
        report.addProperty("compilerSpecId", currentProgram.getCompilerSpec().getCompilerSpecID().getIdAsString());
        report.add("disabledAnalyzers", disableAnalyzers(profile.getAsJsonArray("disabledAnalyzers")));
        report.addProperty("appliedSeeds", applySeeds(profile.getAsJsonArray("seeds")));
        currentProgram.getOptions(Program.PROGRAM_INFO).setString("DSH analysis preparation", gson.toJson(report));
        println("DSH analysis preparation: " + gson.toJson(report));
    }

    private Address address(String value) {
        Address address = currentProgram.getAddressFactory().getAddress(value);
        if (address == null) throw new IllegalArgumentException("Address is outside the selected program: " + value);
        return address;
    }

    private void entry(Address entry, String name) throws Exception {
        MemoryBlock block = currentProgram.getMemory().getBlock(entry);
        if (block == null || !block.isInitialized() || !block.isExecute())
            throw new IllegalArgumentException("Entry point must lie in initialized executable memory");
        addEntryPoint(entry);
        if (currentProgram.getListing().getInstructionAt(entry) == null && !disassemble(entry))
            throw new IllegalStateException("The selected entry point cannot be decoded");
        if (getFunctionAt(entry) == null && createFunction(entry, name) == null)
            throw new IllegalStateException("The selected entry point cannot become a function");
    }

    private void prepareRaw(JsonObject imported) throws Exception {
        if (!currentProgram.getExecutableFormat().equals("Raw Binary"))
            throw new IllegalArgumentException("Raw preparation requires BinaryLoader");
        Address base = address(imported.get("baseAddress").getAsString());
        MemoryBlock block = currentProgram.getMemory().getBlock(base);
        if (block == null || !block.getStart().equals(base))
            throw new IllegalArgumentException("Raw import does not begin at its selected base address");
        boolean originalStart = false;
        for (MemoryBlockSourceInfo source : block.getSourceInfos())
            if (source.getFileBytes().isPresent() && source.getFileBytesOffset() == 0 && source.getMinAddress().equals(base)) originalStart = true;
        if (!originalStart) throw new IllegalArgumentException("Raw base does not map the start of the sample");
        block.setExecute(true);
        entry(address(imported.get("entryAddress").getAsString()), "entry");
    }

    private void prepareCom() throws Exception {
        if (!currentProgram.getLanguageID().getIdAsString().equals("x86:LE:16:Real Mode")
            || !currentProgram.getExecutableFormat().equals("Raw Binary"))
            throw new IllegalArgumentException("DOS COM requires a raw x86 real-mode import");
        Address first = address("1000:0100");
        MemoryBlock block = currentProgram.getMemory().getBlock(first);
        if (block == null || !block.getStart().equals(first) || block.getSize() < 1 || block.getSize() > 0xff00)
            throw new IllegalArgumentException("DOS COM must map 1..65280 bytes at 1000:0100");
        block.setExecute(true);
        for (String name : List.of("CS", "DS", "ES", "SS"))
            currentProgram.getProgramContext().setValue(currentProgram.getRegister(name), first, block.getEnd(), BigInteger.valueOf(0x1000));
        entry(first, "entry");
    }

    private record Section(String kind, int index, long offset, long address, long size) {}
    private record Range(long address, long size) {}

    private long uint32(JsonObject value, String name) {
        long result = value.get(name).getAsBigDecimal().longValueExact();
        if (result < 0 || result > 0xffffffffL) throw new IllegalArgumentException("DOL " + name + " exceeds uint32");
        return result;
    }

    private long header(ByteBuffer header, int offset) { return Integer.toUnsignedLong(header.getInt(offset)); }

    private void prepareDol(JsonObject plan) throws Exception {
        if (plan == null || !currentProgram.getLanguageID().getIdAsString().startsWith("PowerPC:BE:32:")
            || !currentProgram.getExecutableFormat().equals("Raw Binary"))
            throw new IllegalArgumentException("DOL requires a validated section plan and raw big-endian PowerPC import");
        Memory memory = currentProgram.getMemory();
        List<FileBytes> files = memory.getAllFileBytes();
        if (files.size() != 1 || files.get(0).getSize() < 0x100)
            throw new IllegalArgumentException("DOL requires one complete imported file image");
        FileBytes bytes = files.get(0);
        byte[] encoded = new byte[0x100];
        if (bytes.getOriginalBytes(0, encoded) != encoded.length) throw new IllegalStateException("DOL header is incomplete");
        ByteBuffer header = ByteBuffer.wrap(encoded).order(ByteOrder.BIG_ENDIAN);
        List<Section> sections = new ArrayList<>();
        Set<String> selected = new HashSet<>();
        for (JsonElement item : plan.getAsJsonArray("sections")) {
            JsonObject value = item.getAsJsonObject();
            String kind = value.get("kind").getAsString();
            int index = value.get("index").getAsBigDecimal().intValueExact();
            boolean text = kind.equals("text");
            if ((!text && !kind.equals("data")) || index < 0 || index >= (text ? 7 : 11) || !selected.add(kind + index))
                throw new IllegalArgumentException("DOL section identity is invalid");
            long offset = uint32(value, "fileOffset"), address = uint32(value, "address"), size = uint32(value, "size");
            if (size == 0 || offset < 0x100 || offset + size > bytes.getSize() || address + size > 0x100000000L
                || header(header, (text ? 0 : 0x1c) + index * 4) != offset
                || header(header, (text ? 0x48 : 0x64) + index * 4) != address
                || header(header, (text ? 0x90 : 0xac) + index * 4) != size)
                throw new IllegalArgumentException("DOL section plan differs from its file header");
            sections.add(new Section(kind, index, offset, address, size));
        }
        for (int index = 0; index < 18; index++)
            if (header(header, 0x90 + index * 4) != 0 && !selected.contains((index < 7 ? "text" + index : "data" + (index - 7))))
                throw new IllegalArgumentException("DOL plan omitted a nonempty section");
        sections.sort(Comparator.comparingLong(Section::address));
        for (int index = 1; index < sections.size(); index++)
            if (sections.get(index - 1).address() + sections.get(index - 1).size() > sections.get(index).address())
                throw new IllegalArgumentException("DOL memory sections overlap");
        long entry = uint32(plan, "entryPoint");
        if (entry != header(header, 0xe0) || sections.stream().noneMatch(section -> section.kind().equals("text") && entry >= section.address() && entry < section.address() + section.size()))
            throw new IllegalArgumentException("DOL entry is outside its executable sections");
        long bssStart = header(header, 0xd8), bssSize = header(header, 0xdc);
        JsonObject bss = plan.getAsJsonObject("bss");
        if (uint32(bss, "address") != bssStart || uint32(bss, "size") != bssSize || bssStart + bssSize > 0x100000000L)
            throw new IllegalArgumentException("DOL BSS differs from its file header");
        List<Range> gaps = new ArrayList<>();
        long position = bssStart;
        for (Section section : sections) {
            if (section.address() >= bssStart + bssSize || section.address() + section.size() <= position) continue;
            if (position < section.address()) gaps.add(new Range(position, section.address() - position));
            position = Math.max(position, section.address() + section.size());
        }
        if (position < bssStart + bssSize) gaps.add(new Range(position, bssStart + bssSize - position));
        JsonArray plannedGaps = plan.getAsJsonArray("bssGaps");
        if (plannedGaps.size() != gaps.size()) throw new IllegalArgumentException("DOL BSS gap count differs");
        for (int index = 0; index < gaps.size(); index++) {
            JsonObject gap = plannedGaps.get(index).getAsJsonObject();
            if (uint32(gap, "address") != gaps.get(index).address() || uint32(gap, "size") != gaps.get(index).size())
                throw new IllegalArgumentException("DOL BSS gap differs from its mapped sections");
        }
        for (MemoryBlock block : memory.getBlocks())
            for (MemoryBlockSourceInfo source : block.getSourceInfos())
                if (source.getFileBytes().isPresent() && source.getFileBytes().get().equals(bytes)) {
                    memory.removeBlock(block, monitor);
                    break;
                }
        AddressSpace space = currentProgram.getAddressFactory().getDefaultAddressSpace();
        for (Section section : sections) {
            MemoryBlock block = memory.createInitializedBlock("." + section.kind() + section.index(), space.getAddress(section.address()), bytes, section.offset(), section.size(), false);
            block.setRead(true);
            block.setWrite(section.kind().equals("data"));
            block.setExecute(section.kind().equals("text"));
        }
        int index = 0;
        for (Range gap : gaps) {
            MemoryBlock block = memory.createUninitializedBlock(".bss" + index++, space.getAddress(gap.address()), gap.size(), false);
            block.setRead(true);
            block.setWrite(true);
            block.setExecute(false);
        }
        entry(space.getAddress(entry), "entry");
    }

    private JsonArray disableAnalyzers(JsonArray names) throws Exception {
        JsonArray report = new JsonArray();
        AutoAnalysisManager manager = AutoAnalysisManager.getAnalysisManager(currentProgram);
        Set<String> installed = new HashSet<>();
        for (Analyzer analyzer : ClassSearcher.getInstances(Analyzer.class)) installed.add(analyzer.getName());
        for (JsonElement value : names) {
            monitor.checkCancelled();
            String name = value.getAsString();
            if (!installed.contains(name)) throw new IllegalArgumentException("Unknown Ghidra analyzer: " + name);
            boolean applicable = manager.getAnalyzer(name) != null;
            if (applicable) {
                setAnalysisOption(currentProgram, name, "false");
                if (!"false".equals(getCurrentAnalysisOptionsAndValues(currentProgram).get(name)))
                    throw new IllegalStateException("Ghidra analyzer remained enabled: " + name);
            }
            JsonObject item = new JsonObject();
            item.addProperty("name", name);
            item.addProperty("status", applicable ? "disabled" : "not_applicable");
            report.add(item);
        }
        return report;
    }

    private int applySeeds(JsonArray values) throws Exception {
        List<JsonObject> seeds = new ArrayList<>();
        for (JsonElement value : values) seeds.add(value.getAsJsonObject());
        seeds.sort((left, right) -> address(right.get("address").getAsString()).compareTo(address(left.get("address").getAsString())));
        int applied = 0;
        for (String kind : List.of("function", "code", "label")) {
            for (JsonObject seed : seeds) {
                if (!seed.get("kind").getAsString().equals(kind)) continue;
                monitor.checkCancelled();
                Address at = address(seed.get("address").getAsString());
                MemoryBlock block = currentProgram.getMemory().getBlock(at);
                if (block == null || (!kind.equals("label") && !block.isInitialized()))
                    throw new IllegalArgumentException("Analysis seed is outside mapped memory: " + at);
                String name = seed.has("name") ? seed.get("name").getAsString() : null;
                if (kind.equals("label")) createLabel(at, name, true, SourceType.USER_DEFINED);
                else {
                    if (currentProgram.getListing().getInstructionAt(at) == null && !disassemble(at))
                        throw new IllegalArgumentException("Analysis seed cannot be decoded: " + at);
                    if (kind.equals("function")) {
                        Function function = getFunctionAt(at);
                        if (function == null) function = createFunction(at, name);
                        else if (name != null) function.setName(name, SourceType.USER_DEFINED);
                        if (function == null) throw new IllegalArgumentException("Analysis seed cannot become a function: " + at);
                    }
                }
                applied++;
            }
        }
        if (applied != seeds.size()) throw new IllegalArgumentException("Unknown analysis seed kind");
        return applied;
    }
}
