---
title: OOP Football Score Simulator
description: >-
  An Object-Oriented Python project that simulates American football games with
  team records, realistic scoring, and automatic stat updates.
published: true
published_at: 2025-08-19T00:00:00.000Z
last_reviewed: 2026-05-22T00:00:00.000Z
cover_image: ./images/oop-football-score-simulator-output.png
cover_alt: >-
  Python source for the simulator's Team class — the __init__, __repr__, and
  __str__ methods tracking each franchise's wins, losses, and points.
technologies:
  - python
featured: false
---

# OOP Football Score Simulator

![hero](/assets/writeups/oop-football-score-simulator/images/oop-football-score-simulator-output.png)

[View on GitHub](https://github.com/joeseverino/football-score-simulator)

## Features

- **Object-Oriented Design** – Teams are modeled as Python classes with attributes (wins, losses, points) and methods for updating stats.
- **Game Simulation** – Matches generate scores using touchdowns, field goals, and PATs with realistic probability.
- **Automatic Record Keeping** – Each team’s record (wins–losses–ties) and points for/against update after every game.
- **Readable Outputs** – Custom \_\_str\_\_ and \_\_repr\_\_ methods provide clear displays for debugging and results.
- **Randomized Scenarios** – Uses Python’s random library to produce dynamic, varied outcomes across simulations.

## Requirements

- Python 3.x

## How to Run

Clone the repository and run the simulator:

::terminal
$ git clone https://github.com/joeseverino/football-score-simulator.git
$ cd football-score-simulator
$ python3 football.py
::
