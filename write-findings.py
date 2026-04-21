import textwrap
content = open("findings-content.txt").read()
open("pattern-finder-findings.md", "w").write(content)
print("done")