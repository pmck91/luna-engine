---
title: Rooms, objects and characters
description: Build a map, connect exits, place objects and give characters inventories and local properties.
sidebar:
  order: 2
---

## Locations and exits

Add locations with **Add location**. Name and describe each room, and choose the game's starting location in settings.

On **World map**, enable the exit tool. Choose a source room and target room by clicking near their borders. Luna creates border anchors near those clicks. Each exit is directed: create the reverse route separately when travel should work both ways.

Drag anchors around the border to separate routes. Drag a label to make it readable; a detached label has a faint dashed leader to the closest point on its route. Moving the drawing changes layout, not the destination or command.

Select an exit to edit its name/aliases, destination, **Visible when**, **Traversable when**, blocked text and effects. Visibility controls discovery; traversability controls travel. A visible locked route can explain why it is blocked. Use `go east` or the route's authored alternatives.

## Objects

Use **Add object**, set **Name**, aliases, description and **Initial placement**. Choose a room, player inventory, character inventory, absent, or an appropriate container/surface.

**Can be taken** describes whether physical player transfers may move an object. **Initially hidden** controls visibility. An absent item has no world placement; hiding a placed item and removing it are different operations.

New objects include Examine → PRINT DESCRIPTION. Use **Add starter actions** for missing common actions and [storage setup](/luna-engine/logic/containers/) for containers. Describe visible surroundings clearly enough to suggest valid nouns.

## Characters

A character has an initial room, aliases, description, optional name colour, properties, actions, triggers and hints. Give them a **CHARACTER SAYS** block for attributed speech. **MOVE CHARACTER** moves them directly to a location; held items move with them. It does not move the player or run player entry events.

Use **Initial inventory** on the character or an object's Initial placement to give them an item. Each item has one placement. Character-held items do not appear in the player's inventory and are not ordinary command targets until an authored action transfers them.

Use an intentionally disconnected room for offstage characters when useful. Acknowledge the corresponding reachability warning with an optional reason; it does not make the room reachable. See [findings](/luna-engine/editor/testing/).

## Properties and initial state

Properties belong to one entity; global variables belong to the game. Two characters may each have a `health` property. Their values are independent. [Values and conditions](/luna-engine/logic/values/) explains types and comparisons.

These forms set **initial** state. A running playtest retains its current positions and values until restarted or explicitly changed through its debug state tools.
