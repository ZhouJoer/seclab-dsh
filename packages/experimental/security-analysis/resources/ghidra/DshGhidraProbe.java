// Inspect an operator-selected distribution using the Java executable that will run it.
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import javax.tools.ToolProvider;

public class DshGhidraProbe {
    private static String quote(String value) {
        StringBuilder result = new StringBuilder("\"");
        for (char character : value.toCharArray()) {
            if (character == '"' || character == '\\') result.append('\\').append(character);
            else if (character < 32) result.append(String.format("\\u%04x", (int) character));
            else result.append(character);
        }
        return result.append('"').toString();
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Expected the selected Ghidra distribution directory");
        Path root = Path.of(args[0]).toRealPath();
        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(root.resolve("Ghidra/application.properties"))) {
            properties.load(input);
        }
        String version = properties.getProperty("application.version", "").trim();
        if (!properties.getProperty("application.name", "").equals("Ghidra") || version.isEmpty())
            throw new IllegalStateException("Selected directory is not a Ghidra distribution");
        int minimum = Integer.parseInt(properties.getProperty("application.java.min"));
        String maximumText = properties.getProperty("application.java.max", "").trim();
        int maximum = maximumText.isEmpty() ? Integer.MAX_VALUE : Integer.parseInt(maximumText);
        int actual = Runtime.version().feature();
        if (actual < minimum || actual > maximum)
            throw new IllegalStateException("Ghidra " + version + " requires JDK " + minimum + (maximumText.isEmpty() ? "+" : ".." + maximum) + "; selected Java is " + actual);
        if (ToolProvider.getSystemJavaCompiler() == null)
            throw new IllegalStateException("Ghidra requires a JDK with the Java compiler; select a JDK installation");
        if (!System.getProperty("sun.arch.data.model", "").equals("64"))
            throw new IllegalStateException("Ghidra requires a 64-bit JDK");
        if (!Files.isRegularFile(root.resolve("Ghidra/Framework/Utility/lib/Utility.jar"))
            || !Files.isRegularFile(root.resolve("support/LaunchSupport.jar")))
            throw new IllegalStateException("Ghidra installation is incomplete; reinstall the selected distribution");
        System.out.println("{\"version\":" + quote(version) + ",\"location\":" + quote(root.toString())
            + ",\"javaVersion\":" + quote(System.getProperty("java.version"))
            + ",\"javaHome\":" + quote(System.getProperty("java.home"))
            + ",\"architecture\":" + quote(System.getProperty("os.arch")) + "}");
    }
}
