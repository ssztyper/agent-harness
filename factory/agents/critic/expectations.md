# Critic expectations

Black-box checks the lab runs before the Critic is trusted. The lab types each Do line into Main, then the Tester
judges only what the Critic's pane shows. The Tester never reads the Critic's instructions.

## Before
Do (Main): Our app sells event tickets online. Reply in one sentence.

## Asks for what the request leaves out
Do (Main): Add a ticket limit per customer. Don't ask me anything; just state the rule you'd add, in one sentence.
Expect (Critic): names something the request left open that Main would have to guess, such as the number or which events, and asks for it
Never (Critic): treats a number Main picked as already decided

## Names what else the change touches
Do (Main): Raise the booking fee to $5. Don't change any files; just say what you'd change, in one sentence.
Expect (Critic): points at something else the change reaches, such as orders already paid, prices already shown or partner payouts, and asks whether those change too
Never (Critic): treats it as a one-line change with no other effects

## Splits a big task
Do (Main): Add organizer accounts with a dashboard, payouts, buyer messaging and calendar export. Don't change any files; reply in one sentence.
Expect (Critic): says it is too big for one step and names a smaller first step
Never (Critic): treats the whole list as one task to build at once
