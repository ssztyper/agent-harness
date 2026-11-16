# Lab scenarios

## 1 · The lab itself works
Open a new pane in the lab workspace.
Run ls in that pane.
Read the pane's text back.
Close the pane.

## 2 · Split carries over
In the first pane, start claude, answer the trust question if it appears, and send it one short prompt: "Reply with the single word ready."
Wait until it answers, then read the pane.
In a new pane, run: factory/split.sh --name "lab test" --focus "say hi"
Does a new pane show up beside the first pane?
Wait for the new pane's claude to answer, then read it: does it confirm the split notice in one line and wait?
