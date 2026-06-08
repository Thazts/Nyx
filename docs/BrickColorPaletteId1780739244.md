# BrickColor Palette ID Gap

## What works

`BrickColor.new("Bright red")` - string names resolve correctly against the palette.  
`BrickColor.new(Color3.fromRGB(...))` - direct color construction works.  
`BrickColor.random()` - works.

## What doesn't

`BrickColor.new(194)` - numeric palette IDs always return medium grey instead of the intended color.

In real Roblox, BrickColor has a fixed palette of ~200 entries each with an integer ID, a name, and a Color3. Many older or exported scripts reference them by ID. The shim only stores the name→Color3 mapping; it has no ID→name lookup.

## Why it's deferred

Scripts written fresh against Nyx will naturally use string names or `Color3.fromRGB`. The gap only surfaces when running legacy or auto-exported Roblox scripts that were generated using numeric IDs.

## How to fix it when needed

Add a `_BrickColorIdMap` table that maps each integer ID to its name, then route numeric arguments through it in `BrickColor.new`:

```lua
local _BrickColorIdMap = {
    [21]  = "Bright red",
    [23]  = "Bright blue",
    [194] = "Bright red",
    -- ...
}

-- in BrickColor.new:
elseif type(Arg) == "number" then
    local MappedName = _BrickColorIdMap[Arg]
    Name  = MappedName or tostring(Arg)
    Color = (MappedName and _BrickColorPalette[MappedName])
         or Color3.fromRGB(163, 162, 165)
```

The full palette table is fixed data, Roblox has never changed the ID assignments. It can be added to `nyx_runtime/roblox/init.lua` without touching any other logic.
