# Memories expectations

Black-box checks for the Memories agent. The lab types each Do line, then the Tester judges only what the panes show.

## Before
Do (Main): Our app sells event tickets online. Reply in one sentence.

## Suggests a rule
Do (Main): Keep all money in integer cents, never floats. Reply in one sentence.
Expect (Memories): suggests exactly one numbered memory that states the rule about integer cents
Never (Memories): suggests more than one memory for this turn

## Keep writes one line
Do (shell): factory/agent.sh keep #1 && tail -1 KEEP.md
Expect (shell): the shell shows that one memory was kept, and the last line of KEEP.md states the integer-cents rule with a source

## Stays quiet on small talk
Do (Main): Thanks, that looks good. Reply in one word.
Expect (Memories): shows "Nothing to keep." for this turn
Never (Memories): suggests a memory for this turn
