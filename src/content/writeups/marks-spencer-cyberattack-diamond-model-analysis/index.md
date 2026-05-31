---
title: Marks & Spencer Cyberattack – Diamond Model Analysis
description: >-
  Analyzing the 2025 Marks & Spencer cyberattack using the Diamond Model,
  mapping identity-based intrusion techniques to MITRE ATT&CK and aligning
  remediation strategies with NIST controls.
published: true
published_at: 2026-03-29T00:00:00.000Z
last_reviewed: 2026-05-30T00:00:00.000Z
cover_image: ./images/marks-spencer-cyberattack-diamond-model.png
technologies:
  - diamond-model
  - mitre-attack
  - nist
featured: false
---

# Marks & Spencer Cyberattack – Diamond Model Analysis

![hero](/assets/writeups/marks-spencer-cyberattack-diamond-model-analysis/images/marks-spencer-cyberattack-diamond-model.png)

## Incident Overview

On April 22, 2025, Marks & Spencer publicly acknowledged a cyber incident that disrupted store operations and forced parts of its online shopping infrastructure offline. The impact grew over the following days, and online ordering did not resume until June 10, 2025. The company also disclosed that customer data was exposed and later estimated the incident would reduce operating profit by roughly £300 million.

## Adversary

The attack has been widely attributed to Scattered Spider, a financially motivated cybercrime group known for targeting large organizations through social engineering. The group has been linked to similar incidents involving major retailers, typically focusing on identity-based intrusion methods rather than traditional exploits.

## Infrastructure

Rather than relying on attacker-controlled systems, the intrusion leveraged trusted enterprise infrastructure. The attackers targeted Tata Consultancy Services, a third-party vendor, and exploited weaknesses in the IT helpdesk password reset process to gain access to a legitimate account. From there, they were able to move into internal systems that supported online ordering and logistics, representing abuse of legitimate (Type-2) infrastructure within the Diamond Model.

## Capability

This incident was driven by identity-focused social engineering combined with ransomware deployment. By impersonating an internal employee, the attackers were able to bypass identity verification controls and gain system access. Once inside, they exfiltrated sensitive data and deployed DragonForce ransomware to disrupt operations and create extortion pressure. Some reporting suggested SIM-swapping as a possible method for bypassing MFA, though this was not officially confirmed.

## Victim

Marks & Spencer was the primary victim due to its scale and heavy reliance on interconnected digital systems. The attack also impacted Tata Consultancy Services through the initial social engineering vector, and ultimately affected customers whose personal data was exposed. Because a significant portion of M&S’s revenue depends on e-commerce, the disruption had a direct and substantial financial impact.

## MITRE ATT&CK Mapping

| Technique                 | ID    | Relevance                                                                       |
|---------------------------|-------|---------------------------------------------------------------------------------|
| Impersonation             | T1656 | Attackers posed as a legitimate employee during helpdesk interaction            |
| Valid Accounts            | T1078 | Compromised credentials were used to access legitimate internal systems         |
| Data Encrypted for Impact | T1486 | Ransomware was deployed to encrypt systems and create extortion pressure        |

## Key Takeaways

This incident shows that modern ransomware attacks often start with identity compromise, not malware. It also highlights how vendor access and helpdesk workflows can become real intrusion paths when verification is weak. At scale, the operational disruption alone can be just as damaging as the data theft itself.

## Policy Recommendations

The core issue in this incident was not the absence of security frameworks, but a failure in how controls were implemented. Strengthening helpdesk identity verification, tightening account recovery procedures, and improving visibility into outbound data movement would directly address the weaknesses exploited in this attack. Moving away from SMS-based authentication toward stronger methods like authenticator apps or passkeys would also reduce exposure to identity-based attacks.

These recommendations align with the National Institute of Standards and Technology Cybersecurity Framework. PR.AA (Identity Management and Authentication) addresses identity verification weaknesses, PR.AC (Access Control) reinforces least privilege and controlled access, and DE.CM (Security Continuous Monitoring) supports detecting abnormal data movement through controls such as data loss prevention.

## Source Paper

This analysis is based on a research paper written as part of my graduate curriculum at the Georgia Institute of Technology.

[Full Paper](/assets/writeups/marks-spencer-cyberattack-diamond-model-analysis/images/term-paper-diamond-model-policy-assessment.pdf)
