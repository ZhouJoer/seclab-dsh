# Reporting selection

Reports are assembled in bounded sections inside the analysis directory from saved evidence; the reporting-workflow playbook owns structure and review.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Web page screenshots | gowitness-class | eyewitness-class when manual review of captures is needed |
| Format conversion | pandoc-class | PDF export per the audience's format requirement |
| Finding normalization | structured output from scanners (JSONL/JSON) reduced to finding tables | Keep raw files alongside summaries |
| Report structure | reporting-workflow playbook | Do not invent a custom structure |

Severity scoring defaults to CVSS v4.0 with v3.1 where the audience's databases require it; compliance mapping (PCI DSS, SOC 2, HIPAA) is added per engagement terms. Every finding references its saved evidence and captured-call identity rather than restating file contents.
