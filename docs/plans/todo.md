# Items left to work on

## Characters
- the editor needs a way to give character inventory
- there needs to be a new world logic to give and remove an item to a characters inventory
- characters need to have a way to talk, instead of say, there should be a character says aswell, which prints <character name> says: <message>

## Actions
- there needs to be an option to trigger an action when a sequence of say runs out, eg you inspect an item three times, and an event or action triggers. for instance, you poke a character 3 times, and on the fourth he punches you. 

## UI
 - move the vocabulary to be with the variables 
 - make end game scenarios have their own item and menu along side variables and vocabulary
 - there should be the ability to create command snippets that can be saved to prevent having to duplicate logic by hand (in the game code itself, these can duplicate, the snippet can be UI only)

## engine behaviour
- [x] Add Print description response blocks and default examine actions for new entities.
- [x] Print variables and entity properties in messages with `%variable_name%` and `%entity_id.property_name%`, with an insertion menu in the editor.

## Docs

- add full in depth architecture doc on the parser
- add full in depth architecture doc on the game files
- add full in depth architecture doc on the runner
- add User facing docs for editor, including screenshots, a basic first game tutorial, components & tools.
