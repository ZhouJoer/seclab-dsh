// Test-only controls for correction acceptance against an installed Ghidra.
// @category DSH Tests
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.program.model.data.FloatDataType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.ParameterImpl;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.SourceType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/** Seeds one known incorrect analysis fact, then verifies the packaged repair changed it. */
public final class DshGhidraCorrectionFixture extends HeadlessScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 3) throw new IllegalArgumentException("Expected stage, correction kind and output path");
        Function function = currentProgram.getFunctionManager().getFunctions(true).next();
        if (args[0].equals("prepare")) {
            if (args[1].equals("no-return")) function.setNoReturn(true);
            else {
                function.setCustomVariableStorage(false);
                function.setCallingConvention(currentProgram.getCompilerSpec().getDefaultCallingConvention().getName());
                function.setReturnType(FloatDataType.dataType, SourceType.USER_DEFINED);
                function.replaceParameters(Function.FunctionUpdateType.DYNAMIC_STORAGE_ALL_PARAMS, true,
                    SourceType.USER_DEFINED, new ParameterImpl("value", FloatDataType.dataType, currentProgram));
                currentProgram.getOptions(Program.PROGRAM_INFO).setString("DSH fixture return storage", function.getReturn().getVariableStorage().toString());
            }
            return;
        }
        if (!args[0].equals("verify")) throw new IllegalArgumentException("Unknown fixture stage");
        JsonObject result = new JsonObject();
        result.addProperty("correction", args[1]);
        result.addProperty("language", currentProgram.getLanguageID().getIdAsString());
        String key = args[1].equals("no-return") ? "DSH analysis repairs"
            : args[1].equals("mips") ? "DSH MIPS soft-float storage" : "DSH RISC-V calling convention";
        String encoded = currentProgram.getOptions(Program.PROGRAM_INFO).getString(key, null);
        if (encoded == null) throw new IllegalStateException("Correction did not publish its completion report");
        JsonObject report = new Gson().fromJson(encoded, JsonObject.class);
        if (args[1].equals("no-return")) {
            if (function.hasNoReturn() || report.getAsJsonObject("noReturn").get("clearedFunctions").getAsInt() < 1)
                throw new IllegalStateException("The fixture no-return flag was not corrected");
        } else {
            String expected = args[1].equals("mips") ? "__dsh_soft_float" : "__dsh_ilp32";
            if (!function.getCallingConventionName().equals(expected) || report.get("functions").getAsInt() < 1)
                throw new IllegalStateException("The fixture calling convention was not corrected");
            String before = currentProgram.getOptions(Program.PROGRAM_INFO).getString("DSH fixture return storage", "");
            String after = function.getReturn().getVariableStorage().toString();
            if (before.equals(after)) throw new IllegalStateException("The fixture return storage did not change");
            result.addProperty("returnStorageBefore", before);
            result.addProperty("returnStorageAfter", after);
            result.addProperty("parameterStorageAfter", function.getParameter(0).getVariableStorage().toString());
        }
        result.add("report", report);
        DecompInterface decompiler = new DecompInterface();
        try {
            if (!decompiler.openProgram(currentProgram)) throw new IllegalStateException(decompiler.getLastMessage());
            DecompileResults decompiled = decompiler.decompileFunction(function, 30, monitor);
            if (!decompiled.decompileCompleted() || decompiled.getDecompiledFunction() == null)
                throw new IllegalStateException("Corrected fixture did not decompile: " + decompiled.getErrorMessage());
            result.addProperty("pseudocode", decompiled.getDecompiledFunction().getC());
        } finally { decompiler.dispose(); }
        Files.writeString(Path.of(args[2]), new Gson().toJson(result), StandardOpenOption.CREATE_NEW);
        println("DSH correction fixture passed: " + args[1]);
    }
}
