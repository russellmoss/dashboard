const fs=require("fs"); const lines=["# Test","line2"]; fs.writeFileSync("C:/Users/russe/Documents/Dashboard/exploration/code-inspector-findings.md", lines.join("
")); console.log("done");