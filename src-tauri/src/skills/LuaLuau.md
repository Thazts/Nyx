$2!
# Lua and Luau Reference

Apply this knowledge when writing or reviewing Lua or Luau code, particularly in a Roblox context. Luau is Roblox's typed fork of Lua 5.1. Understanding the distinction between Lua idioms and Luau-specific features matters; not every Lua pattern applies cleanly to Luau, and not every Luau feature exists in plain Lua.

---

## Language Fundamentals

### Variables and Scope
Always prefer `local` variables. Global variables in Lua persist for the lifetime of the script environment and pollute shared state. There is almost never a reason to use a global.

```luau
local X = 10          -- correct
Y = 10                -- avoid: implicit global
```

Luau does not have block-scoped `let`/`const`. A `local` declared inside a `do...end` block is scoped to that block, which is the idiomatic way to limit scope.

```luau
do
    local Temp = ComputeSomething()
    UseTemp(Temp)
end
-- Temp is inaccessible here
```

### Tables
Tables are the single data structure in Lua/Luau. They serve as arrays, dictionaries, sets, objects, and modules. Understanding their dual nature is foundational.

Array-style tables use integer keys starting at 1. `#Table` gives the length, but only reliably for sequences (no nil holes).

```luau
local Fruits = { "apple", "banana", "cherry" }
for Index, Value in ipairs(Fruits) do
    print(Index, Value)   -- 1, 2, 3 in order
end
```

Dictionary-style tables use any non-nil key.

```luau
local Config = {
    MaxSpeed = 50,
    Gravity  = -9.8,
    Name     = "Player",
}
```

`pairs` iterates all key-value pairs in arbitrary order. `ipairs` iterates integer keys in order and stops at the first nil. Never mix them up.

### Functions
Functions are first-class values. Prefer named locals over anonymous assignments for readability and stack traces.

```luau
-- preferred
local function Greet(Name: string): string
    return "Hello, " .. Name
end

-- also valid, but anonymous
local Greet = function(Name: string): string
    return "Hello, " .. Name
end
```

Variadic functions use `...` and `table.pack` / `table.unpack`.

```luau
local function Sum(...: number): number
    local Total = 0
    for _, Value in { ... } do
        Total += Value
    end
    return Total
end
```

### String Operations
Lua strings are immutable. Concatenation with `..` creates a new string every time; avoid it inside tight loops. Use `table.concat` for building strings from many parts.

```luau
-- slow in a loop
local Result = ""
for _, Word in Words do
    Result = Result .. Word .. " "
end

-- fast
local Parts = {}
for Index, Word in Words do
    Parts[Index] = Word
end
local Result = table.concat(Parts, " ")
```

String methods are accessed via the colon syntax or through the `string` library. Both are equivalent; `Str:upper()` is `string.upper(Str)`.

### Error Handling
`error()` throws. `pcall(fn, ...)` calls a function and catches errors, returning `success, result`. `xpcall(fn, handler, ...)` does the same but passes the error to a handler first, which can format or log it.

```luau
local Ok, Result = pcall(function()
    return RiskyOperation()
end)

if not Ok then
    warn("Operation failed:", Result)
end
```

Never use bare `error()` for control flow. Reserve it for genuinely exceptional conditions. For expected failure cases, return `nil, message` instead.

```luau
local function FindPlayer(Name: string): (Player?, string?)
    local Found = Players:FindFirstChild(Name)
    if not Found then
        return nil, "Player not found: " .. Name
    end
    return Found :: Player, nil
end
```

### Metatables and OOP
Lua OOP is built on metatables. The canonical pattern uses `__index` to implement inheritance and method lookup.

```luau
local Animal = {}
Animal.__index = Animal

function Animal.new(Name: string, Sound: string): Animal
    return setmetatable({
        Name  = Name,
        Sound = Sound,
    }, Animal)
end

function Animal:Speak(): string
    return self.Name .. " says " .. self.Sound
end

type Animal = typeof(Animal.new("", ""))
```

Inheritance uses a second `setmetatable` to chain `__index`.

```luau
local Dog = setmetatable({}, { __index = Animal })
Dog.__index = Dog

function Dog.new(Name: string): Dog
    local Self = Animal.new(Name, "woof")
    return setmetatable(Self, Dog)
end

function Dog:Fetch(Item: string): string
    return self.Name .. " fetches the " .. Item
end

type Dog = typeof(Dog.new(""))
```

### Coroutines
Coroutines are cooperative threads; they yield and resume explicitly. In Roblox, `task.spawn` and `task.defer` are preferred over raw coroutines for most cases.

```luau
local Co = coroutine.create(function()
    for I = 1, 3 do
        coroutine.yield(I)
    end
end)

coroutine.resume(Co)  -- yields 1
coroutine.resume(Co)  -- yields 2
coroutine.resume(Co)  -- yields 3
```

---

## Luau Type System

Luau adds a gradual, optional type system to Lua. Type checking is controlled per-file with a header comment.

```luau
--!strict     -- all type errors are reported
--!nonstrict  -- only clear errors are reported (default)
--!nocheck    -- type checking disabled entirely
```

Prefer `--!strict` in new files. It catches real bugs.

### Primitive Types
`string`, `number`, `boolean`, `nil`, `any`, `never`, `unknown`

### Annotations
Annotate function parameters and return types. Variable annotations are optional but useful for complex types.

```luau
local Count: number = 0

local function Add(A: number, B: number): number
    return A + B
end
```

### Optional Types
`T?` is shorthand for `T | nil`.

```luau
local function FindById(Id: number): Player?
    return Players:FindFirstChild(tostring(Id)) :: Player?
end
```

When consuming an optional, narrow it before use; the type checker enforces this in strict mode.

```luau
local Found = FindById(123)
if Found then
    print(Found.Name)  -- Found is Player here, not Player?
end
```

### Union and Intersection Types
```luau
type StringOrNumber = string | number
type Named = { Name: string }
type Aged  = { Age: number }
type Person = Named & Aged   -- intersection: has both Name and Age
```

### Generic Types and Functions
```luau
type Stack<T> = {
    Push: (self: Stack<T>, value: T) -> (),
    Pop:  (self: Stack<T>) -> T?,
    Data: { T },
}

local function Identity<T>(Value: T): T
    return Value
end
```

### Type Casting
Use `::` to assert a type when the checker cannot infer it. Reserve this for situations where you are certain of the type; it bypasses checking.

```luau
local Part = Workspace:FindFirstChild("Floor") :: BasePart
```

### `typeof` for Derived Types
Use `typeof(Constructor())` to derive the type of an object from its constructor, which avoids duplicating the shape as a separate `type` declaration.

```luau
type Config = typeof({
    Speed   = 0,
    Enabled = false,
    Name    = "",
})
```

---

## Roblox Architecture

### The Client-Server Model
Roblox games run on two separate environments. Understanding this boundary is the most important concept in Roblox development.

| Script Type     | Runs On | Location                          |
|-----------------|---------|-----------------------------------|
| `Script`        | Server  | ServerScriptService, Workspace    |
| `LocalScript`   | Client  | StarterGui, StarterPack, StarterCharacterScripts |
| `ModuleScript`  | Either  | Anywhere, required by caller     |

A `ModuleScript` required by a server Script runs on the server. The same `ModuleScript` required by a LocalScript runs on the client. They are separate instances with separate state. Never assume shared state between client and server.

### Service Access
All core services are accessed via `game:GetService()`. Never rely on the short-hand `game.Players`; it fails if the service name changes and is slower to look up. Cache service references at the top of each script.

```luau
local Players        = game:GetService("Players")
local RunService     = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService   = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local HttpService    = game:GetService("HttpService")
local DataStoreService = game:GetService("DataStoreService")
```

### Folder Conventions
| Container              | Purpose                                              |
|------------------------|------------------------------------------------------|
| `ServerScriptService`  | Server scripts, never replicated to client          |
| `ServerStorage`        | Server-only assets and data                          |
| `ReplicatedStorage`    | Shared modules, RemoteEvents, assets for both sides  |
| `StarterGui`           | UI, cloned into each player's PlayerGui on join     |
| `StarterPack`          | Tools — cloned into each player's Backpack           |
| `StarterPlayer`        | StarterCharacterScripts, StarterPlayerScripts        |
| `Workspace`            | The 3D world                                         |

### Instance Hierarchy and WaitForChild
`FindFirstChild` returns nil immediately if the child does not exist. `WaitForChild` yields until the child exists or times out. Always use `WaitForChild` in LocalScripts accessing instances that may not have replicated yet. Always pass a timeout.

```luau
-- server: FindFirstChild is safe because server has full authority
local Part = Workspace:FindFirstChild("Floor")

-- client: WaitForChild because replication may not be complete
local Part = Workspace:WaitForChild("Floor", 5)
if not Part then
    warn("Floor did not replicate in time")
end
```

---

## Client-Server Communication

### RemoteEvent vs RemoteFunction vs BindableEvent

| Type              | Direction           | Yields Caller? | Use Case                            |
|-------------------|---------------------|----------------|-------------------------------------|
| `RemoteEvent`     | Client ↔ Server    | No             | Fire-and-forget messages            |
| `RemoteFunction`  | Client → Server    | Yes (client)   | Request/response, client needs reply|
| `BindableEvent`   | Same side only      | No             | Decouple scripts on the same side   |
| `BindableFunction`| Same side only      | Yes            | Synchronous callbacks same side     |

Store all RemoteEvents and RemoteFunctions in `ReplicatedStorage`. Keep their names in a shared constants module so both sides reference the same string.

```luau
-- ReplicatedStorage/Remotes/init.luau (ModuleScript)
local Remotes = {}
Remotes.DealDamage  = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("DealDamage") :: RemoteEvent
Remotes.GetInventory = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("GetInventory") :: RemoteFunction
return Remotes
```

### Firing and Listening
```luau
-- Server: fire to one client
Remote:FireClient(Player, Data)

-- Server: fire to all clients
Remote:FireAllClients(Data)

-- Client: fire to server
Remote:FireServer(Data)

-- Server: listen
Remote.OnServerEvent:Connect(function(Player: Player, Data: any)
    -- always validate Player and Data server-side
end)

-- Client: listen
Remote.OnClientEvent:Connect(function(Data: any)
end)
```

### Server-Side Validation
Never trust data sent from the client. Always validate on the server: check types, ranges, ownership, and whether the action is legal given the current game state. A client can fire any RemoteEvent with any data at any time.

```luau
Remote.OnServerEvent:Connect(function(Player: Player, TargetId: any, Damage: any)
    if type(TargetId) ~= "number" then return end
    if type(Damage) ~= "number" then return end
    if Damage <= 0 or Damage > 100 then return end

    local Target = FindPlayerById(TargetId)
    if not Target then return end

    -- proceed with validated data
    ApplyDamage(Target, Damage)
end)
```

---

## Module Patterns

### Standard Module
A ModuleScript must return exactly one value, typically a table. This table becomes the module's public API.

```luau
local MyModule = {}

function MyModule.DoThing(): string
    return "done"
end

return MyModule
```

### Singleton Services
For systems that should only exist once (inventory manager, data manager, etc.), use a module that initialises itself on first require.

```luau
local InventoryService = {}
InventoryService.__index = InventoryService

local _Instance: typeof(InventoryService) | nil = nil

function InventoryService.Get()
    if not _Instance then
        _Instance = setmetatable({
            _Cache = {} :: { [Player]: { string } },
        }, InventoryService)
    end
    return _Instance
end

function InventoryService:Add(Player: Player, Item: string)
    local Inv = self._Cache[Player] or {}
    table.insert(Inv, Item)
    self._Cache[Player] = Inv
end

return InventoryService
```

### Lazy Initialisation
Avoid running code at require time unless necessary. Modules are cached after the first require; if one module requires another at the top level and that creates a circular dependency, both will see incomplete tables.

```luau
-- avoid: runs at require time
local Players = game:GetService("Players")
Players.PlayerAdded:Connect(OnPlayerAdded)   -- side effect at require time

-- prefer: explicit init function called by the entry script
function MyModule.Init()
    Players.PlayerAdded:Connect(OnPlayerAdded)
end
```

---

## Event Patterns

### Connecting and Disconnecting
Always store connections when they need to be cleaned up. Leaked connections prevent garbage collection of the objects they reference.

```luau
local Connection = RunService.Heartbeat:Connect(function(DeltaTime: number)
    Update(DeltaTime)
end)

-- when done:
Connection:Disconnect()
```

For character-scoped connections (reset on respawn), connect inside `CharacterAdded` and disconnect inside `CharacterRemoving` or on the character's `AncestryChanged`.

```luau
Players.PlayerAdded:Connect(function(Player: Player)
    Player.CharacterAdded:Connect(function(Character: Model)
        local Humanoid = Character:WaitForChild("Humanoid") :: Humanoid

        local DiedConn: RBXScriptConnection
        DiedConn = Humanoid.Died:Connect(function()
            DiedConn:Disconnect()
            OnCharacterDied(Player)
        end)
    end)
end)
```

### Custom Signals
For internal event buses, implement a minimal signal class rather than reaching for BindableEvent (which has overhead and creates Instances).

```luau
type Callback = (...any) -> ()

type Signal = {
    Connect:    (self: Signal, fn: Callback) -> () -> (),
    Fire:       (self: Signal, ...any) -> (),
    _Listeners: { Callback },
}

local Signal = {}
Signal.__index = Signal

function Signal.new(): Signal
    return setmetatable({ _Listeners = {} }, Signal) :: any
end

function Signal:Connect(Fn: Callback): () -> ()
    table.insert(self._Listeners, Fn)
    return function()
        local Index = table.find(self._Listeners, Fn)
        if Index then table.remove(self._Listeners, Index) end
    end
end

function Signal:Fire(...: any)
    for _, Fn in self._Listeners do
        task.spawn(Fn, ...)
    end
end

return Signal
```

---

## Task Scheduling

Prefer `task.*` over legacy Lua scheduling. The `task` library is designed for Roblox's scheduler and behaves correctly with the engine's frame timing.

| Function         | Behaviour                                              |
|------------------|--------------------------------------------------------|
| `task.spawn`     | Runs immediately in a new thread                       |
| `task.defer`     | Runs at the end of the current frame                   |
| `task.delay`     | Runs after N seconds                                   |
| `task.wait`      | Yields for N seconds (or one frame if N is 0)          |
| `task.cancel`    | Cancels a `task.delay` or `task.defer` thread          |

Never use `wait()` (the global). It has poor timing accuracy and does not interact cleanly with the task scheduler. Always use `task.wait()`.

Never use `spawn()` (the global). Use `task.spawn()` instead; the global has inconsistent error propagation.

```luau
-- bad
spawn(function()
    wait(1)
    DoThing()
end)

-- good
task.delay(1, DoThing)
```

---

## RunService Patterns

| Event              | Fires On | Rate       | Use Case                            |
|--------------------|----------|------------|-------------------------------------|
| `Heartbeat`        | Server + Client | Every frame | Physics simulation, server game loop |
| `Stepped`          | Server + Client | Every frame, before physics | Pre-physics updates |
| `RenderStepped`    | Client only | Every frame, before render | Camera, visual updates |

`RenderStepped` is client-only and fires before the frame is rendered. Heavy work here causes frame drops. Keep `RenderStepped` callbacks as lean as possible.

```luau
RunService.RenderStepped:Connect(function(DeltaTime: number)
    UpdateCamera(DeltaTime)   -- lightweight only
end)

RunService.Heartbeat:Connect(function(DeltaTime: number)
    UpdateGameLogic(DeltaTime)
end)
```

Use `RunService:IsServer()` and `RunService:IsClient()` to write isomorphic modules that behave differently per environment.

```luau
if RunService:IsServer() then
    InitServerSystems()
else
    InitClientSystems()
end
```

---

## DataStore Patterns

DataStores are rate-limited and can fail. Always wrap calls in `pcall`. Always use a retry loop or a queue for important writes.

```luau
local DataStoreService = game:GetService("DataStoreService")
local PlayerStore = DataStoreService:GetDataStore("PlayerData")

local function LoadData(Player: Player): ({ [string]: any }?, string?)
    local Ok, Result = pcall(function()
        return PlayerStore:GetAsync(tostring(Player.UserId))
    end)
    if not Ok then
        return nil, "DataStore read failed: " .. tostring(Result)
    end
    return Result or {}, nil
end

local function SaveData(Player: Player, Data: { [string]: any }): (boolean, string?)
    local Ok, Err = pcall(function()
        PlayerStore:SetAsync(tostring(Player.UserId), Data)
    end)
    if not Ok then
        return false, "DataStore write failed: " .. tostring(Err)
    end
    return true, nil
end
```

Always save on `Players.PlayerRemoving` and use `game:BindToClose` to handle server shutdown.

```luau
game:BindToClose(function()
    for _, Player in Players:GetPlayers() do
        SaveData(Player, GetPlayerData(Player))
    end
end)
```

---

## Performance Guidelines

**Cache service and object references.** Every `:FindFirstChild` and `game:GetService` call has a cost. Store the result in a local.

**Cache frequently accessed properties.** Property reads on Instances cross the Lua-C++ boundary. If you read `Part.Position` 60 times a frame, store it in a local first.

```luau
RunService.Heartbeat:Connect(function()
    local Pos = Part.Position   -- one boundary crossing
    local Distance = (Pos - Target).Magnitude
end)
```

**Preallocate tables.** `table.create(n, value)` allocates a table with `n` slots upfront, avoiding repeated resizing.

```luau
local Results = table.create(100)
```

**Use `table.move` for bulk copies.** It is faster than a manual loop for large tables.

**Avoid string concatenation in tight loops.** Use `table.concat` on a collected parts table.

**Disconnect unused connections.** Connections that fire every frame but are no longer needed are pure overhead.

**Avoid `pairs` when `ipairs` applies.** On array tables, `ipairs` is faster and communicates intent more clearly.

---

## Common Anti-Patterns

**Polling with a loop instead of events.**
```luau
-- bad: burns CPU checking every frame
while true do
    if Character:FindFirstChild("Humanoid").Health <= 0 then
        OnDeath()
    end
    task.wait()
end

-- good: event-driven
Humanoid.Died:Connect(OnDeath)
```

**`WaitForChild` without a timeout in production.**
If the child never arrives, the script yields forever silently.
```luau
-- bad
local Part = Workspace:WaitForChild("MaybeExists")

-- good
local Part = Workspace:WaitForChild("MaybeExists", 5)
if not Part then warn("MaybeExists not found") end
```

**Trusting client-sent data.** Validate everything on the server. See Server-Side Validation above.

**Requiring modules with side effects at the top level.** Creates fragile load-order dependencies and circular require risks.

**Using `print` for error reporting in production.** Use `warn` for non-fatal issues, `error` for fatal ones. `print` is invisible in production logs and does not capture stack traces.

**Using deprecated globals.** `wait()`, `spawn()`, `delay()`, `tick()` are all legacy. Use `task.wait()`, `task.spawn()`, `task.delay()`, `os.clock()` respectively.

**Storing player data in the character model.** Characters are destroyed and recreated on respawn. Store player-scoped data keyed by `Player`, not by character.

---

## Naming Conventions

Roblox's official style guide and common community practice align on most points. Luau code in this project follows PascalCase throughout, consistent with the Thazts App Framework.

| Kind                       | Convention    | Example               |
|----------------------------|---------------|-----------------------|
| Variables and locals       | PascalCase    | `LocalPlayer`         |
| Functions                  | PascalCase    | `function GetHealth()` |
| Types                      | PascalCase    | `type PlayerData = {}` |
| Constants                  | SCREAMING_SNAKE or PascalCase | `MAX_HEALTH` or `MaxHealth` |
| Private module fields      | `_PascalCase` | `_Cache`              |
| Roblox Instances           | PascalCase    | matches Roblox naming |
| Services                   | PascalCase    | `Players`, `RunService` |

---

## Luau vs Lua 5.1 Differences

Luau diverges from Lua 5.1 in several ways relevant to Roblox developers:

- **No `debug` library** in production; use Roblox's built-in debugger
- **No `io`, `os.execute`, `os.exit`**, sandboxed environment
- **`table.pack`, `table.unpack`, `table.move`** are available (backported from 5.2+)
- **`string.split`** is available as a Roblox extension
- **Compound assignment** operators exist: `+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `^=`, `..=`
- **Type annotations** are Luau-only; plain Lua 5.1 will reject them
- **`continue`** statement is available in Luau (not in Lua 5.1)
- **Generalized `for` loop** (`for K, V in Table do`) works on any table, not just iterators
- **`if` expressions** (ternary-style): `local X = if Condition then A else B`
- **String interpolation** with backtick syntax: `` `Hello, {Name}!` ``

---

## Nyx Runtime Constraints

The Nyx viewport runtime embeds **mlua (Lua 5.4)**, not Luau. Scripts run in the viewport execute under a standard Lua 5.4 interpreter. This means all Luau-specific syntax is a parse error.

### Type Annotations Are Not Supported

The most common mistake is writing Luau type annotations in function signatures:

```luau
-- BREAKS in Nyx: Lua 5.4 cannot parse ': Type' annotations
local function HsvToColor3(H: number, S: number, V: number): Color3
    ...
end
```

Error produced: `syntax error: ')' expected near ':'`

Remove all `: TypeName` annotations from function parameters and return types:

```lua
-- Works in Nyx
local function HsvToColor3(H, S, V)
    ...
end
```

### Other Luau Syntax That Will Break

| Feature | Luau syntax | Lua 5.4 equivalent |
|---|---|---|
| Parameter types | `function F(X: number)` | `function F(X)` |
| Return type | `function F(): string` | `function F()` |
| Variable annotation | `local X: number = 0` | `local X = 0` |
| Type aliases | `type Foo = { ... }` | remove entirely |
| Type cast | `Value :: Type` | remove or use a local |
| Compound assignment | `X += 1` | `X = X + 1` |
| `continue` statement | `continue` | restructure with `if` |
| Generalized `for` | `for K, V in T do` | `for K, V in pairs(T) do` |
| `if` expression | `local X = if C then A else B` | `local X; if C then X = A else X = B end` |
| String interpolation | `` `Hello {Name}` `` | `"Hello " .. Name` |

### Header Comments Are Fine

`--!strict`, `--!nonstrict`, and `--!nocheck` are plain comments in Lua 5.4. They are silently ignored and do not cause errors.
