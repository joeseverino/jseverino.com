---
title: Deploying a Wazuh SIEM Lab for Endpoint Monitoring and Vulnerability Detection
description: >-
  A Wazuh SIEM lab used to monitor a Windows endpoint, detect vulnerabilities,
  investigate malware alerts, and configure automated email notifications.
published: true
published_at: 2026-03-08T00:00:00.000Z
last_reviewed: 2026-05-17T00:00:00.000Z
cover_image: ./images/wazuh-siem-lab-cover.png
technologies:
  - smtp
  - ubuntu-linux
  - vulnerability-detection
  - wazuh-siem
  - windows-endpoint
featured: false
---

# Deploying a Wazuh SIEM Lab for Endpoint Monitoring and Vulnerability Detection

![hero](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-siem-lab-cover.png)

#### Project Overview

This exercise involved deploying [Wazuh](https://wazuh.com/), an open source Security Information and Event Management (SIEM) and Extended Detection and Response (XDR) platform in a home lab environment.

#### Lab Architecture

This lab environment was designed to simulate a simplified enterprise security monitoring architecture. Windows endpoint runs the Wazuh agent, which collects system and security telemetry and forwards it to the centralized Wazuh server hosted on an Ubuntu virtual machine. The Wazuh server performs log analysis, threat detection, and vulnerability monitoring while storing indexed event data and presenting alerts through the Wazuh dahboard.

::figure
![Architecture diagram of the Wazuh SIEM lab](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-siem-lab-architecture.png)

Wazuh SIEM Lab Architecture
::

::figure
![VirtualBox VM configuration for the Ubuntu Wazuh server](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-virtualbox-vm-configuration.png)

Ubuntu VM hosting the Wazuh Server
::

#### Wazuh Deployment

After provisioning an Ubuntu 24.04.3 Virtual Machine, I changed the Network Adapter to use a Bridged Adapter instead of NAT to prevent future issues. I then entered the following commands to download the Wazuh Installer, make it executable, and ran the installer.

```text
curl -sO https://packages.wazuh.com/4.14/wazuh-install.sh
chmod +x wazuh-install.sh
sudo ./wazuh-install.sh -a
```

::figure
![Terminal showing the Wazuh installation completed successfully](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-installation-successful.png)

Successful completion of the Wazuh installation process
::

After the installation completed, I ran the following commands ensuring the Manager, Indexer, and Dashboard are running with no issues.

```text
sudo systemctl status wazuh-manager | head -n 7
sudo systemctl status wazuh-indexer | head -n 7
sudo systemctl status wazuh-dashboard | head -n 7
```

::figure
![Running status for all three Wazuh server processes](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-service-status.png)

Running status for all 3 processes
::

I then obtained the VM IP address using *hostname -i* and opened that within the Windows machine browser.

::figure
![Wazuh dashboard login page served over HTTPS](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-admin-login.png)

Wazuh dashboard login page accessible via HTTPS
::

Finally, I downloaded the Wazuh Agent Package [here](https://documentation.wazuh.com/current/installation-guide/packages-list.html) and ran the installer on the Windows Endpoint. I then typed in the Manager IP that I gathered previously and ran the following command within PowerShell in the `C:\Program Files (x86)\ossec-agent` folder.

```text
.\agent-auth.exe -m 192.168.1.22
```

::figure
![Wazuh agent installer after generating an authentication key](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-agent-installer.png)

Wazuh Agent after successful Authentication key generation
::

::figure
![Wazuh dashboard overview](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-endpoint-overview.png)

Wazuh Dashboard Overview
::

::figure
![Wazuh endpoints view showing one active agent](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-managed-endpoints.png)

Wazuh Endpoints showing one active agent
::

#### Vulnerability Detection

Now that the Windows endpoint was onboarded, the Wazuh vulnerability detection began analyzing installed software and comparing it against known vulnerabilities from public CVE databases.

::figure
![High-severity CVEs detected on the Windows endpoint before remediation](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-high-severity-vulnerability-before-remediation.png)

High severity CVEs detected on the Windows endpoint
::

Each detected vulnerability is mapped to a CVE Identifier and includes detailed information such as the affected package, version, severity rating, and vulnerability description.

::figure
![Wazuh vulnerability detail view for a detected CVE](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-vulnerability-details.png)

Detailed vulnerability details for CVE-2026-21523
::

To remediate the detected vulnerabilities, I updated Visual Studio Code, Wireshark, and Python.

::figure
![Updating the vulnerable Python installation on the Windows endpoint](/assets/writeups/deploying-a-wazuh-siem-lab/images/windows-endpoint-python-update.png)

Updating the vulnerable Python installation
::

After the updates completed, the Wazuh agent service was restarted so the manager could refresh the endpoint telemetry.

::figure
![Restarting the Wazuh agent service on Windows](/assets/writeups/deploying-a-wazuh-siem-lab/images/restart-wazuh-agent-service.png)

Restarting the Wazuh Windows agent service
::

Once the system inventory was rescanned, the Wazuh vulnerability dashboard confirmed that the previously detected high-severity vulnerabilities were no longer present.

::figure
![Wazuh vulnerability dashboard with no high-severity CVEs after remediation](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-high-severity-vulnerability-after-remediation.png)

Vulnerability dashboard after remediation showing no remaining high-severity CVEs.
::

This remediation process demonstrates how SIEM platforms can be used not only to detect threats, but also for vulnerability management and system hardening.

#### Malware Detection Test

Purpose: prove the SIEM detects malicious activity from the endpoint.

To validate that endpoint telemetry was properly ingested into the SIEM, I downloaded the EICAR antivirus test file on the Windows endpoint. Windows Defender immediately detected the file and generated Event ID 1116 in the Defender log.

::figure
![Windows Defender blocking the EICAR test file download](/assets/writeups/deploying-a-wazuh-siem-lab/images/windows-defender-blocked-download.png)

Defender blocked the file from downloading
::

::figure
![Windows Defender protection history showing the blocked test threat](/assets/writeups/deploying-a-wazuh-siem-lab/images/windows-protection-history-blocked-threat.png)

Microsoft Defender detecting the EICAR test file and generating a malware detection event
::

::figure
![Wazuh dashboard alert generated from the Defender detection event](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-dashboard-alerts-after-test-threat.png)

Wazuh ingesting the Defender event and generating a high-severity security alert
::

#### Incident Investigation

The generated alert was investigated in the Wazuh dashboard to examine the associated telemetry. The alert identified the source as Microsoft Defender and included information such as the hostname, detection time, file path, and malware classification.

::figure
![Wazuh alert detail showing Defender telemetry and threat classification](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-threat-event-details.png)

Detailed Wazuh alert information showing Defender telemetry and threat classification
::

#### Alert Notification Configuration

Wazuh alerts were configured to send email notifications through a locally configured Postfix relay. The relay authenticates to the domain’s SMTP server and forwards alerts to an external mailbox. Domain email authentication records (SPF, DKIM, and DMARC) were configured to ensure proper email deliverability and prevent spoofing.

::figure
![Email notification triggered by the Wazuh malware detection alert](/assets/writeups/deploying-a-wazuh-siem-lab/images/wazuh-email-alert-notification.png)

Email notification generated after the malware detection alert was triggered
::

#### Lessons Learned

- SIEM deployments require adequate storage. During the initial setup, the Ubuntu VM didn’t have enough disk space allocated, which prevented Wazuh from starting correctly. Expanding the VM storage resolved the issue.
- Bridged networking simplified communication between the endpoint and SIEM server. Using a bridged adapter allowed the Windows endpoint to communicate directly with the Ubuntu Wazuh server using the local network IP.
- Email alerts required more infrastructure work than expected. Wazuh was configured to send alerts through a Postfix relay using a custom domain email account. This required configuring DNS through Cloudflare, creating a mailbox in cPanel, and ensuring SMTP was setup correctly.
- A single endpoint alert contains a lot of telemetry. Investigating the Defender detection in Wazuh showed how much context is collected from a single event that can be filtered and manipulated to create custom dashboards.
