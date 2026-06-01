---
title: Math Quiz Game
description: >-
  A simple command-line math quiz game written in Python. The program prompts
  the user to select a difficulty level (1–3) and then challenges them with 10
  random addition problems. The player has up to 3 attempts for each question,
  and their final score is displayed at the end.
published: true
published_at: 2025-08-10T00:00:00.000Z
last_reviewed: 2026-05-22T00:00:00.000Z
cover_image: ./images/math-quiz-game-home-screen.png
cover_alt: >-
  Python source for the math quiz CLI — the INCORRECT, QUESTIONS, and TRIES
  constants and the start of the main() loop that prompts the player for a
  difficulty level.
technologies:
  - python
featured: false
---

# Math Quiz Game

![hero](/assets/writeups/math-quiz-game/images/math-quiz-game-home-screen.png)

[View on GitHub](https://github.com/joeseverino/math-quiz-game)

## Features

- Three difficulty levels:
  - **Level 1:** Single-digit numbers (0–9)
  - **Level 2:** Two-digit numbers (10–99)
  - **Level 3:** Three-digit numbers (100–999)
- 10 randomized questions per game
- Up to 3 attempts per question
- Clear feedback for incorrect answers

## Requirements

- Python 3.x

## How to Run

Clone the repository and run the script:

::terminal
$ git clone https://github.com/joeseverino/math-quiz-game.git
$ cd math-quiz-game
$ python3 math-quiz-game.py
::
