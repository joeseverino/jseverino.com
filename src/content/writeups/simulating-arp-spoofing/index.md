---
title: Simulating ARP Spoofing with Mininet and Demonstrating Enterprise Mitigations
description: >-
  A networking security lab that simulates ARP spoofing in Mininet, analyzes
  packet captures in Wireshark, and demonstrates enterprise mitigations using
  DHCP Snooping and Dynamic ARP Inspection in Cisco Packet Tracer.
published: true
published_at: 2026-03-15T00:00:00.000Z
last_reviewed: 2026-05-17T00:00:00.000Z
cover_image: ./images/arp-spoofing-lab-cover.png
cover_alt: >-
  Wireshark capture highlighting a "duplicate IP address detected" warning, the
  telltale signature of an ARP spoofing attack on the lab network.
technologies:
  - cisco-packet-tracer
  - mininet
  - python
  - wireshark
featured: false
---

# Simulating ARP Spoofing with Mininet and Demonstrating Enterprise Mitigations

![hero](/assets/writeups/simulating-arp-spoofing/images/arp-spoofing-lab-cover.png)

## Project Overview

Address Resolution Protocol (ARP) spoofing is a common Layer-2 attack that allows an adversary to intercept network traffic by manipulating MAC address resolution. This project demonstrates how ARP spoofing can be performed within a virtual network created using Mininet, Open vSwitch, and the POX controller. By poisoning the ARP tables of two hosts, the attacker can become a man-in-the-middle and observe and manipulate network traffic between them. Packet captures are used to analyze how spoofed ARP replies redirect traffic and enable interception. Then I demonstrate how enterprise networks mitigate this attack using security mechanisms such as DHCP Snooping and Dynamic ARP Inspection.

## Lab Architecture

This lab environment was built using [Mininet](https://mininet.org/) and [Open vSwitch](https://www.openvswitch.org/). Three hosts were connected to a single Layer-2 switch controlled by a [POX SDN Controller](https://github.com/noxrepo/pox). The attacker host was placed on the same broadcast domain as the victim and target to allow for ARP poisoning.

::figure
![Mininet topology of three hosts on an Open vSwitch managed by a POX controller](/assets/writeups/simulating-arp-spoofing/images/mininet-arp-spoofing-topology.png)

Mininet topology with three hosts connected to an Open vSwitch instance managed by a POX SDN Controller.
::

::table
| Node | IP Address | MAC Address       |
|------|------------|-------------------|
| h1   | 10.0.0.1   | 00:00:00:00:01:1e |
| h2   | 10.0.0.2   | 00:00:00:00:02:1e |
| h3   | 10.0.0.3   | 00:00:00:00:03:1e |

This topology uses manually assigned IP and MAC addresses to make ARP table behavior deterministic during the simulation.
::

::figure
![POX controller establishing an OpenFlow connection with the virtual switch](/assets/writeups/simulating-arp-spoofing/images/mininet-controller-connected.png)

The POX controller successfully establishes an OpenFlow connection with the virtual switch (s1).
::

::figure
![Mininet initializing the network from a script](/assets/writeups/simulating-arp-spoofing/images/mininet-network-startup.png)

Mininet initializing from the predetermined script.
::

```text
./pox.py forwarding.l2_learning
sudo python topology.py
```

The Mininet topology was launched using a [custom Python script](https://github.com/joeseverino/arp-spoofing-mininet-lab/blob/main/topology.py), and the POX controller successfully established an OpenFlow connection with the virtual switch.

## Attack Setup

To demonstrate ARP spoofing, normal HTTP traffic was first generated between the victim (h1) and the target server (h2). The attacker (h3) then launched an ARP poisoning attack to intercept communication between the two nodes.

::figure
![Python HTTP server starting on host h2](/assets/writeups/simulating-arp-spoofing/images/python-http-server-startup.png)

An HTTP server is launched on h2 to allow for application-layer traffic in this experiment.
::

```text
h2> python -m http.server 80
```

::figure
![Wireshark packet capture started on the switch interface](/assets/writeups/simulating-arp-spoofing/images/wireshark-packet-capture-startup.png)

A packet capture is started on the switch interface to observe traffic during the attack.
::

```text
s1> tcpdump -i s1-eth1 -w vulnerable.pcap
```

::figure
![Normal ARP table and HTTP traffic between hosts h1 and h2](/assets/writeups/simulating-arp-spoofing/images/mininet-host-curl-normal-traffic.png)

Normal ARP table and HTTP communication between h1 and h2.
::

```text
h1> arp -n
h1> curl http://10.0.0.2
```

::figure
![The attacker host launching arpspoof against h1 and h2](/assets/writeups/simulating-arp-spoofing/images/arpspoof-attack-startup.png)

The attacker host starts ARP spoofing to poison the ARP table of both h1 and h2.
::

```text
h3> arpspoof -t 10.0.0.1 10.0.0.2
h3> arpspoof -t 10.0.0.2 10.0.0.1
```

::figure
![Poisoned ARP table with h3 mapped to the h2 address during interception](/assets/writeups/simulating-arp-spoofing/images/mininet-host-curl-intercepted-traffic.png)

The ARP table now shows h3 associated with 10.0.0.2 while HTTP communication appears to be working as expected.
::

```text
h1> arp -n
h1> curl http://10.0.0.2
```

## Packet Capture Analysis

The [Wireshark](https://www.wireshark.org/) packet capture analysis shows that the attacker successfully spoofed ARP replies, claiming ownership of 10.0.0.2. As a result, the victim updates its ARP table and begins forwarding traffic to the attacker’s MAC address instead of the real host’s.

::figure
![Wireshark capture of spoofed ARP replies claiming the h2 IP address](/assets/writeups/simulating-arp-spoofing/images/wireshark-spoofed-arp-reply-capture.png)

h3 continuously sends ARP replies claiming ownership of 10.0.0.2.
::

::figure
![Wireshark showing traffic for h2 redirected to the attacker host](/assets/writeups/simulating-arp-spoofing/images/wireshark-intercepted-tcp-traffic.png)

Traffic destined for h2 (10.0.0.2) is actually being sent to h3’s MAC address.
::

[View PCAP File](https://github.com/joeseverino/arp-spoofing-mininet-lab/blob/main/vulnerable.pcap)

## Attack Flow

The ARP spoofing attack works through the following steps:

1.  Normal communication
    - The victim, h1, sends an HTTP request to the target, h2, and uses ARP to resolve the MAC address with the associated IP address 10.0.0.2.
2.  Attacker begins ARP poisoning
    - The attacker, h3, begins sending spoofed ARP replies claiming that the IP address 10.0.0.2 is associated with its own MAC address (::03:1e).
3.  ARP table is now poisoned
    - The victim, h1, receives the spoofed ARP reply, which associates the gateway IP address with the MAC address of the attacker.
4.  Traffic is now redirected through the attacker
    - Traffic intended for h2 is now sent to h3, allowing the attacker to intercept and forward packets.
5.  Man-in-the-middle established
    - By enabling IP forwarding, h3 relays packets between the victim and target while eavesdropping on all packets between the two.

## Security Implications and Mitigations

ARP spoofing can enable interception and modification of network traffic, usually with no visible indication to the affected victim. This can lead to session hijacking, eavesdropping, data exfiltration, and more. Because ARP does not provide any form of authentication, Layer-2 networks are vulnerable without added protections.

To demonstrate how enterprise networks mitigate ARP spoofing attacks, I recreated the topology in [Cisco Packet Tracer](https://www.netacad.com/skillsforall/files/Cisco_Packet_Tracer_Download_and_Installation_Instructions.pdf) using a Layer-2 switch and a DHCP-enabled router. Security features, DHCP Snooping and Dynamic ARP Inspection (DAI) were configured on the switch to prevent spoofed ARP responses.

::figure
![ARP spoofing topology rebuilt in Cisco Packet Tracer with a DHCP router](/assets/writeups/simulating-arp-spoofing/images/cisco-packet-tracer-arp-spoofing-topology.png)

The topology was recreated in Cisco Packet Tracer with a DHCP-enabled router to support security features such as DHCP Snooping and Dynamic ARP Inspection.
::

::figure
![Cisco router configuration enabling a DHCP pool for the network](/assets/writeups/simulating-arp-spoofing/images/cisco-router-arp-spoofing-config.png)

r1 enables its g0/0 interface and configures a DHCP pool to dynamically assign addresses to hosts on the network.
::

::figure
![Cisco switch configured with DHCP Snooping and Dynamic ARP Inspection](/assets/writeups/simulating-arp-spoofing/images/cisco-switch-arp-spoofing-config.png)

s1 enables DHCP Snooping and Dynamic ARP Inspection, with the router-facing interface f0/5 configured as a trusted port.
::

```text
s1 (config)# ip dhcp snooping
s1 (config)# ip dhcp snooping vlan 1
s1 (config)# ip arp inspection vlan 1
s1 (config)# int f0/5
s1 (config-if)# ip dhcp snooping trust
s1 (config-if)# ip arp inspection trust
```

[View Packet Tracer Lab](https://github.com/joeseverino/arp-spoofing-mininet-lab/blob/main/arp_spoofing_mitigation_lab.pkt)

## Lessons Learned

- While Mininet can simulate the attack, advanced mitigation features such as DHCP Snooping and Dynamic ARP Inspection are not supported. To demonstrate how these are configured in production environments, I recreated the topology in Cisco Packet Tracer.
- Simulated Mininet traffic generates actual packets that can be analyzed in a packet capture. Starting tcpdump prior to the attack allowed for real-world analysis of the effect.
- Manually configuring the IP and MAC addresses on the topology script allowed for the experiment to be deterministic while also repeatable for others.
- The updated ARP tables show just how trusting ARP can be without configuring any security measures.

[View on GitHub](https://github.com/joeseverino/arp-spoofing-mininet-lab)
