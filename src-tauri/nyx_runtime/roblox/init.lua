-- Nyx Engine   Roblox Runtime Shim
_NYX_COMMANDS = {}
_NYX_LIVE_TIME = _NYX_LIVE_TIME or 0
_NYX_HEARTBEAT_CALLBACKS = {}
if not math.pow then
    math.pow = function(Base, Exp) return Base ^ Exp end
end
if os and os.clock then
    local _NyxClockFirst = true
    os.clock = function()
        if _NyxClockFirst then
            _NyxClockFirst = false
            return 0
        end
        return _NYX_LIVE_TIME or 0
    end
end

local function _nyx_json_val(V, Depth)
    Depth = Depth or 0
    if Depth > 32 then return '"[max depth]"' end
    local T = type(V)
    if T == "nil" then
        return "null"
    elseif T == "boolean" then
        return V and "true" or "false"
    elseif T == "number" then
        if V ~= V or V == math.huge or V == -math.huge then return "null" end
        if math.floor(V) == V and math.abs(V) < 1e15 then
            return string.format("%d", V)
        end
        return string.format("%.8g", V)
    elseif T == "string" then
        local S = V
            :gsub("\\", "\\\\")
            :gsub('"',  '\\"')
            :gsub("\n", "\\n")
            :gsub("\r", "\\r")
            :gsub("\t", "\\t")
        return '"' .. S .. '"'
    elseif T == "table" then
        local N = #V
        local Count = 0
        for _ in pairs(V) do Count = Count + 1 end
        if N > 0 and N == Count then
            local Parts = {}
            for I = 1, N do Parts[I] = _nyx_json_val(V[I], Depth + 1) end
            return "[" .. table.concat(Parts, ",") .. "]"
        else
            local Parts = {}
            for K, Val in pairs(V) do
                if type(K) == "string" then
                    Parts[#Parts + 1] = '"' .. K .. '":' .. _nyx_json_val(Val, Depth + 1)
                end
            end
            return "{" .. table.concat(Parts, ",") .. "}"
        end
    end
    return "null"
end

function _nyx_json_encode(T)
    return _nyx_json_val(T)
end

Vector3 = {}
Vector3.__index = Vector3
Vector3.__tostring = function(V)
    return "(" .. V.X .. ", " .. V.Y .. ", " .. V.Z .. ")"
end
Vector3.__add = function(A, B) return Vector3.new(A.X+B.X, A.Y+B.Y, A.Z+B.Z) end
Vector3.__sub = function(A, B) return Vector3.new(A.X-B.X, A.Y-B.Y, A.Z-B.Z) end
Vector3.__mul = function(A, B)
    if type(A) == "number" then return Vector3.new(A*B.X, A*B.Y, A*B.Z) end
    if type(B) == "number" then return Vector3.new(A.X*B, A.Y*B, A.Z*B) end
    return Vector3.new(A.X*B.X, A.Y*B.Y, A.Z*B.Z)
end
Vector3.__unm = function(V) return Vector3.new(-V.X, -V.Y, -V.Z) end
Vector3.__eq  = function(A, B) return A.X == B.X and A.Y == B.Y and A.Z == B.Z end

function Vector3.new(X, Y, Z)
    return setmetatable({ X = X or 0, Y = Y or 0, Z = Z or 0 }, Vector3)
end

Vector3.zero  = Vector3.new(0, 0, 0)
Vector3.one   = Vector3.new(1, 1, 1)
Vector3.xAxis = Vector3.new(1, 0, 0)
Vector3.yAxis = Vector3.new(0, 1, 0)
Vector3.zAxis = Vector3.new(0, 0, 1)

Vector2 = {}
Vector2.__index = Vector2

function Vector2.new(X, Y)
    return setmetatable({ X = X or 0, Y = Y or 0 }, Vector2)
end

Color3 = {}
Color3.__index = Color3

function Color3.new(R, G, B)
    return setmetatable({ R = R or 0, G = G or 0, B = B or 0 }, Color3)
end

function Color3.fromRGB(R, G, B)
    return Color3.new((R or 0) / 255, (G or 0) / 255, (B or 0) / 255)
end

function Color3.fromHex(Hex)
    Hex = (Hex or ""):gsub("#", "")
    local R = tonumber(Hex:sub(1, 2), 16) or 0
    local G = tonumber(Hex:sub(3, 4), 16) or 0
    local B = tonumber(Hex:sub(5, 6), 16) or 0
    return Color3.fromRGB(R, G, B)
end

Color3.White = Color3.new(1, 1, 1)
Color3.Black = Color3.new(0, 0, 0)
Color3.Gray  = Color3.fromRGB(163, 162, 165)
Color3.Red   = Color3.fromRGB(255, 0, 0)
Color3.Green = Color3.fromRGB(0, 255, 0)
Color3.Blue  = Color3.fromRGB(0, 0, 255)

CFrame = {}
CFrame.__index = CFrame

function CFrame.new(X, Y, Z)
    return setmetatable({ X = X or 0, Y = Y or 0, Z = Z or 0, RX = 0, RY = 0, RZ = 0 }, CFrame)
end

function CFrame.Angles(RX, RY, RZ)
    return setmetatable({ X = 0, Y = 0, Z = 0, RX = RX or 0, RY = RY or 0, RZ = RZ or 0 }, CFrame)
end

function CFrame.lookAt(Eye, Target)
    Eye    = Eye    or Vector3.zero
    Target = Target or Vector3.zero
    local DX = Target.X - Eye.X
    local DY = Target.Y - Eye.Y
    local DZ = Target.Z - Eye.Z
    local HorizLen = math.sqrt(DX * DX + DZ * DZ)
    local CF = setmetatable({
        X  = Eye.X, Y = Eye.Y, Z = Eye.Z,
        RX = math.atan2(DY, HorizLen),
        RY = math.atan2(-DX, -DZ),
        RZ = 0,
    }, CFrame)
    CF._eye    = Eye
    CF._target = Target
    return CF
end

CFrame.__mul = function(A, B)
    if getmetatable(B) == CFrame then
        return setmetatable({
            X  = A.X + B.X, Y  = A.Y + B.Y, Z  = A.Z + B.Z,
            RX = (A.RX or 0) + (B.RX or 0),
            RY = (A.RY or 0) + (B.RY or 0),
            RZ = (A.RZ or 0) + (B.RZ or 0),
        }, CFrame)
    end
    if getmetatable(B) == Vector3 then
        return Vector3.new(A.X + B.X, A.Y + B.Y, A.Z + B.Z)
    end
    return A
end

Enum = {}

local function MakeEnum(Values)
    local E = {}
    for _, V in ipairs(Values) do E[V] = V end
    return E
end

Enum.Material = MakeEnum({
    "SmoothPlastic", "Plastic", "Wood", "WoodPlanks", "Marble", "Slate",
    "Concrete", "Granite", "Brick", "Metal", "DiamondPlate", "Foil",
    "Grass", "Sand", "Fabric", "Ice", "Neon", "Glass", "Air",
    "Cobblestone", "Rubber", "Pebble", "Rock", "CorrodedMetal", "ForceField",
})
Enum.PartType        = MakeEnum({ "Block", "Sphere", "Cylinder" })
Enum.EasingStyle     = MakeEnum({
    "Linear", "Sine", "Quad", "Cubic", "Quart", "Quint",
    "Exponential", "Circular", "Back", "Bounce", "Elastic",
})
Enum.EasingDirection = MakeEnum({ "In", "Out", "InOut" })
Enum.CameraType      = MakeEnum({ "Fixed", "Scriptable", "Custom", "Follow", "Track", "Watch", "Attach" })
Enum.RenderFidelity  = MakeEnum({ "Automatic", "Precise", "Performance" })
Enum.LevelOfDetail   = MakeEnum({ "Automatic", "StreamingMesh", "Disabled" })

BrickColor = {}
BrickColor.__index    = BrickColor
BrickColor.__tostring = function(BC) return BC.Name or "BrickColor" end

local _BrickColorPalette = {
    ["White"]                    = Color3.fromRGB(242, 243, 243),
    ["Institutional white"]      = Color3.fromRGB(248, 248, 248),
    ["Black"]                    = Color3.fromRGB(27,  42,  53),
    ["Really black"]             = Color3.fromRGB(17,  17,  17),
    ["Gray"]                     = Color3.fromRGB(163, 162, 165),
    ["Medium stone grey"]        = Color3.fromRGB(163, 162, 165),
    ["Medium stone gray"]        = Color3.fromRGB(163, 162, 165),
    ["Mid gray"]                 = Color3.fromRGB(205, 205, 205),
    ["Light grey"]               = Color3.fromRGB(228, 228, 228),
    ["Light gray"]               = Color3.fromRGB(228, 228, 228),
    ["Dark grey"]                = Color3.fromRGB(99,  95,  98),
    ["Dark gray"]                = Color3.fromRGB(99,  95,  98),
    ["Bright red"]               = Color3.fromRGB(196, 40,  28),
    ["Really red"]               = Color3.fromRGB(255, 0,   0),
    ["Dark red"]                 = Color3.fromRGB(123, 46,  47),
    ["Medium red"]               = Color3.fromRGB(196, 111, 116),
    ["Bright blue"]              = Color3.fromRGB(13,  105, 172),
    ["Really blue"]              = Color3.fromRGB(0,   0,   255),
    ["Dark blue"]                = Color3.fromRGB(0,   32,  96),
    ["Navy blue"]                = Color3.fromRGB(0,   32,  96),
    ["Medium blue"]              = Color3.fromRGB(110, 153, 202),
    ["Pastel blue"]              = Color3.fromRGB(156, 187, 227),
    ["Sand blue"]                = Color3.fromRGB(116, 134, 157),
    ["Bright green"]             = Color3.fromRGB(75,  151, 75),
    ["Lime green"]               = Color3.fromRGB(0,   255, 0),
    ["Earth green"]              = Color3.fromRGB(39,  70,  45),
    ["Sand green"]               = Color3.fromRGB(120, 144, 130),
    ["Pastel green"]             = Color3.fromRGB(204, 255, 153),
    ["Bright yellowish green"]   = Color3.fromRGB(164, 189, 71),
    ["Bright yellow"]            = Color3.fromRGB(245, 205, 48),
    ["New Yeller"]               = Color3.fromRGB(255, 220, 0),
    ["Pastel yellow"]            = Color3.fromRGB(255, 255, 153),
    ["Bright orange"]            = Color3.fromRGB(218, 133, 65),
    ["Dark orange"]              = Color3.fromRGB(168, 111, 50),
    ["Deep orange"]              = Color3.fromRGB(255, 176, 0),
    ["Pastel orange"]            = Color3.fromRGB(255, 201, 133),
    ["Bright violet"]            = Color3.fromRGB(107, 50,  124),
    ["Bright bluish violet"]     = Color3.fromRGB(117, 108, 189),
    ["Bright reddish violet"]    = Color3.fromRGB(143, 76,  42),
    ["Bright bluish green"]      = Color3.fromRGB(0,   143, 156),
    ["Brown"]                    = Color3.fromRGB(105, 64,  40),
    ["Reddish brown"]            = Color3.fromRGB(105, 64,  40),
    ["Sand red"]                 = Color3.fromRGB(149, 121, 119),
    ["Gold"]                     = Color3.fromRGB(239, 184, 56),
    ["Cyan"]                     = Color3.fromRGB(1,   162, 162),
    ["Teal"]                     = Color3.fromRGB(18,  238, 212),
    ["Hot pink"]                 = Color3.fromRGB(255, 0,   191),
    ["Pearl"]                    = Color3.fromRGB(231, 231, 236),
    ["Fog"]                      = Color3.fromRGB(199, 212, 228),
    ["Asphalt"]                  = Color3.fromRGB(91,  93,  105),
    ["Moss"]                     = Color3.fromRGB(127, 142, 100),
    ["Linen"]                    = Color3.fromRGB(253, 234, 190),
    ["Caramel"]                  = Color3.fromRGB(255, 176, 0),
    ["Cinnamon"]                 = Color3.fromRGB(105, 64,  40),
    ["Cocoa"]                    = Color3.fromRGB(105, 64,  40),
    ["Grime"]                    = Color3.fromRGB(127, 142, 100),
}

function BrickColor.new(Arg)
    local Name, Color
    if type(Arg) == "string" then
        Name  = Arg
        Color = _BrickColorPalette[Arg] or Color3.fromRGB(163, 162, 165)
    elseif type(Arg) == "number" then
        Name  = tostring(Arg)
        Color = Color3.fromRGB(163, 162, 165)
    elseif type(Arg) == "table" and getmetatable(Arg) == Color3 then
        Name  = "Custom"
        Color = Arg
    else
        Name  = "Medium stone grey"
        Color = Color3.fromRGB(163, 162, 165)
    end
    return setmetatable({ Name = Name, Color = Color }, BrickColor)
end

function BrickColor.random()
    local Keys = {}
    for K in pairs(_BrickColorPalette) do Keys[#Keys + 1] = K end
    return BrickColor.new(Keys[math.random(#Keys)])
end

local _NYX_PART_ID = 0

local function _NyxVec(V)
    return { X = V.X or 0, Y = V.Y or 0, Z = V.Z or 0 }
end

local function _NyxColor(V)
    return { R = V.R or 0, G = V.G or 0, B = V.B or 0 }
end

local function _NyxFrame(V)
    return { X = V.X or 0, Y = V.Y or 0, Z = V.Z or 0, RX = V.RX or 0, RY = V.RY or 0, RZ = V.RZ or 0 }
end

local function _NyxNonZeroVec(V)
    if not V then return false end
    return (V.X or 0) ~= 0 or (V.Y or 0) ~= 0 or (V.Z or 0) ~= 0
end

local function _NyxTouchesPhysics(K)
    return K == "AssemblyLinearVelocity" or K == "Velocity"
        or K == "AssemblyAngularVelocity" or K == "RotVelocity"
        or K == "Force" or K == "Impulse"
        or K == "Massless" or K == "Mass" or K == "Density"
        or K == "Friction" or K == "Elasticity"
end

local function _NyxApplyPartProperty(P, K, V)
    local C = P and P._NyxCommand
    if P and _NyxTouchesPhysics(K) then
        P._NyxPhysicsTouched = P._NyxPhysicsTouched or {}
        P._NyxPhysicsTouched[K] = true
    end
    if not C then return end
    if K == "Position" then
        C.Position  = _NyxVec(V)
        C.CFrame.X  = V.X or 0
        C.CFrame.Y  = V.Y or 0
        C.CFrame.Z  = V.Z or 0
    elseif K == "Size" then
        C.Size = _NyxVec(V)
    elseif K == "Color" then
        C.Color = _NyxColor(V)
    elseif K == "BrickColor" then
        local Col = type(V) == "table" and V.Color
        if Col then
            rawset(P, "Color", Col)
            C.Color = _NyxColor(Col)
        end
    elseif K == "CFrame" then
        C.CFrame   = _NyxFrame(V)
        C.Position = { X = V.X or 0, Y = V.Y or 0, Z = V.Z or 0 }
    elseif K == "AssemblyLinearVelocity" then
        C.AssemblyLinearVelocity = _NyxVec(V)
        C.Velocity               = _NyxVec(V)
    elseif K == "Velocity" then
        C.Velocity               = _NyxVec(V)
        C.AssemblyLinearVelocity = _NyxVec(V)
    elseif K == "AssemblyAngularVelocity" then
        C.AssemblyAngularVelocity = _NyxVec(V)
        C.RotVelocity             = _NyxVec(V)
    elseif K == "RotVelocity" then
        C.RotVelocity             = _NyxVec(V)
        C.AssemblyAngularVelocity = _NyxVec(V)
    elseif K == "Force"        then C.Force        = _NyxVec(V)
    elseif K == "Impulse"      then C.Impulse      = _NyxVec(V)
    elseif K == "Transparency" then C.Transparency = V or 0
    elseif K == "Material"     then C.Material     = tostring(V or "SmoothPlastic")
    elseif K == "Shape"        then C.Shape        = tostring(V or "Block")
    elseif K == "Anchored"     then C.Anchored     = V and true or false
    elseif K == "CanCollide"   then C.CanCollide   = V and true or false
    elseif K == "Massless"     then C.Massless     = V and true or false
    elseif K == "Mass"         then C.Mass         = V or 1
    elseif K == "Density"      then C.Density      = V or 1
    elseif K == "Friction"     then C.Friction     = V or 0.3
    elseif K == "Elasticity"   then C.Elasticity   = V or 0
    elseif K == "Name"         then C.Name         = tostring(V or "Part")
    end
end

Part = {}
Part.__index = Part

function Part.new()
    _NYX_PART_ID = _NYX_PART_ID + 1
    return setmetatable({
        _id                     = "Part_" .. _NYX_PART_ID,
        _ClassName              = "Part",
        Name                    = "Part",
        Color                   = Color3.fromRGB(163, 162, 165),
        BrickColor              = nil,
        Size                    = Vector3.new(4, 1.2, 2),
        Position                = Vector3.new(0, 0.6, 0),
        CFrame                  = CFrame.new(0, 0.6, 0),
        Anchored                = false,
        CanCollide              = true,
        Transparency            = 0,
        Reflectance             = 0,
        Material                = "SmoothPlastic",
        Shape                   = "Block",
        CastShadow              = true,
        AssemblyLinearVelocity  = Vector3.zero,
        Velocity                = Vector3.zero,
        AssemblyAngularVelocity = Vector3.zero,
        RotVelocity             = Vector3.zero,
        Force                   = Vector3.zero,
        Impulse                 = Vector3.zero,
        Massless                = false,
        Mass                    = nil,
        Density                 = nil,
        Friction                = nil,
        Elasticity              = nil,
        _NyxPhysicsTouched      = {},
        _children               = {},
    }, Part)
end

function Part:GetMass()
    if self.Mass then return self.Mass end
    local S       = self.Size or Vector3.new(4, 1.2, 2)
    local Density = self.Density or 0.7
    return math.max((S.X or 1) * (S.Y or 1) * (S.Z or 1) * Density, 0.001)
end

function Part:ApplyImpulse(Impulse)
    Impulse = Impulse or Vector3.zero
    local Mass = self:GetMass()
    self.AssemblyLinearVelocity = (self.AssemblyLinearVelocity or self.Velocity or Vector3.zero)
        + (Impulse * (1 / Mass))
    self.Impulse = (self.Impulse or Vector3.zero) + Impulse
    self._NyxPhysicsTouched = self._NyxPhysicsTouched or {}
    self._NyxPhysicsTouched.AssemblyLinearVelocity = true
    self._NyxPhysicsTouched.Impulse                = true
end

function Part:ApplyForce(Force)
    self.Force = (self.Force or Vector3.zero) + (Force or Vector3.zero)
    self._NyxPhysicsTouched = self._NyxPhysicsTouched or {}
    self._NyxPhysicsTouched.Force = true
end

function Part:SetNetworkOwner(_) end

function Part:IsA(ClassName)
    return ClassName == "Part"
        or ClassName == "BasePart"
        or ClassName == "PVInstance"
        or ClassName == "Instance"
end

function Part:Destroy()
    -- Viewport destroy is not live yet...
end

function Part:GetChildren()
    return self._children or {}
end

function Part:FindFirstChild(Name)
    for _, Child in ipairs(self._children or {}) do
        if Child.Name == Name then return Child end
    end
    return nil
end

function Part:WaitForChild(Name, _Timeout)
    return self:FindFirstChild(Name)
end

BasePart = Part


local _WorkspaceData = { Gravity = 196.2 }
local _WorkspaceChildren = {}
local _WorkspaceMethods  = {}
local _NyxCameraObj 

workspace = setmetatable({}, {
    __index = function(_, K)
        if K == "CurrentCamera" then return _NyxCameraObj end
        local M = _WorkspaceMethods[K]
        if M ~= nil then return M end
        return _WorkspaceData[K]
    end,
    __newindex = function(_, K, V)
        _WorkspaceData[K] = V
        if K == "Gravity" then
            _NYX_COMMANDS[#_NYX_COMMANDS + 1] = { Cmd = "SetGravity", Value = V or 196.2 }
        end
    end,
})

function _WorkspaceMethods.AddPart(self, P)
    if not P or not P._id then
        print("warning: workspace:AddPart() received an invalid Part")
        return
    end
    local Pos     = P.Position or Vector3.new(0, 0, 0)
    local Siz     = P.Size     or Vector3.new(4, 1.2, 2)
    local Col     = (P.BrickColor and P.BrickColor.Color) or P.Color or Color3.fromRGB(163, 162, 165)
    local CF      = P.CFrame   or CFrame.new(Pos.X, Pos.Y, Pos.Z)
    local Lin     = P.AssemblyLinearVelocity or P.Velocity or Vector3.zero
    local Ang     = P.AssemblyAngularVelocity or P.RotVelocity or Vector3.zero
    local Force   = P.Force   or Vector3.zero
    local Impulse = P.Impulse or Vector3.zero
    local Touched = P._NyxPhysicsTouched or {}

    local Command = {
        Cmd          = "AddPart",
        Id           = P._id,
        Name         = P.Name or P._id,
        Position     = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
        Size         = { X = Siz.X, Y = Siz.Y, Z = Siz.Z },
        Color        = { R = Col.R, G = Col.G, B = Col.B },
        CFrame       = { X = CF.X, Y = CF.Y, Z = CF.Z, RX = CF.RX or 0, RY = CF.RY or 0, RZ = CF.RZ or 0 },
        Anchored     = P.Anchored   and true or false,
        CanCollide   = P.CanCollide and true or false,
        Transparency = P.Transparency or 0,
        Material     = tostring(P.Material or "SmoothPlastic"),
        Shape        = tostring(P.Shape    or "Block"),
    }

    if Touched.AssemblyLinearVelocity or Touched.Velocity or _NyxNonZeroVec(Lin) then
        Command.AssemblyLinearVelocity = { X = Lin.X or 0, Y = Lin.Y or 0, Z = Lin.Z or 0 }
        Command.Velocity               = { X = Lin.X or 0, Y = Lin.Y or 0, Z = Lin.Z or 0 }
    end
    if Touched.AssemblyAngularVelocity or Touched.RotVelocity or _NyxNonZeroVec(Ang) then
        Command.AssemblyAngularVelocity = { X = Ang.X or 0, Y = Ang.Y or 0, Z = Ang.Z or 0 }
        Command.RotVelocity             = { X = Ang.X or 0, Y = Ang.Y or 0, Z = Ang.Z or 0 }
    end
    if Touched.Force   or _NyxNonZeroVec(Force)   then
        Command.Force   = { X = Force.X   or 0, Y = Force.Y   or 0, Z = Force.Z   or 0 }
    end
    if Touched.Impulse or _NyxNonZeroVec(Impulse) then
        Command.Impulse = { X = Impulse.X or 0, Y = Impulse.Y or 0, Z = Impulse.Z or 0 }
    end
    if Touched.Massless  or P.Massless        then Command.Massless  = P.Massless and true or false end
    if Touched.Mass      and P.Mass ~= nil    then Command.Mass      = P.Mass      end
    if Touched.Density   and P.Density ~= nil then Command.Density   = P.Density  end
    if Touched.Friction  and P.Friction ~= nil then Command.Friction  = P.Friction end
    if Touched.Elasticity and P.Elasticity ~= nil then Command.Elasticity = P.Elasticity end

    _NYX_COMMANDS[#_NYX_COMMANDS + 1] = Command
    P._NyxCommand = Command
    P._NyxReg     = true
    _WorkspaceChildren[#_WorkspaceChildren + 1] = P
end

function _WorkspaceMethods.AddParts(self, ...)
    for _, P in ipairs({...}) do self:AddPart(P) end
end

function _WorkspaceMethods.GetChildren(_self)
    local Result = {}
    for I, C in ipairs(_WorkspaceChildren) do Result[I] = C end
    return Result
end

function _WorkspaceMethods.FindFirstChild(_self, Name)
    for _, C in ipairs(_WorkspaceChildren) do
        if C.Name == Name then return C end
    end
    return nil
end

function _WorkspaceMethods.WaitForChild(self, Name, _Timeout)
    return _WorkspaceMethods.FindFirstChild(self, Name)
end

function _WorkspaceMethods.IsA(_self, ClassName)
    return ClassName == "Workspace" or ClassName == "DataModel" or ClassName == "Instance"
end

_NyxCameraObj = setmetatable({}, {
    __newindex = function(Tbl, K, V)
        rawset(Tbl, K, V)
        if K == "CFrame" and type(V) == "table" then
            local Eye    = V._eye    or Vector3.new(V.X or 10, V.Y or 10, V.Z or 10)
            local Target = V._target or Vector3.new(0, 0, 0)
            _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                Cmd      = "SetCamera",
                Position = { X = Eye.X,    Y = Eye.Y,    Z = Eye.Z    },
                LookAt   = { X = Target.X, Y = Target.Y, Z = Target.Z },
            }
        end
    end,
})

local _LightingService = setmetatable({}, {
    __newindex = function(Tbl, K, V)
        rawset(Tbl, K, V)
        if (K == "Ambient" or K == "OutdoorAmbient") and type(V) == "table" then
            _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                Cmd   = "SetSkybox",
                Color = { R = V.R or 0, G = V.G or 0, B = V.B or 0 },
            }
        end
    end,
})

function _LightingService:GetChildren() return {} end
function _LightingService:FindFirstChild(_Name) return nil end
function _LightingService:IsA(ClassName)
    return ClassName == "Lighting" or ClassName == "Instance"
end

local function _MakeSkyInstance()
    local D = { _ClassName = "Sky", SkyColor = Color3.fromRGB(100, 148, 237) }
    return setmetatable({}, {
        __index    = D,
        __newindex = function(_, K, V)
            rawset(D, K, V)
            if K == "Parent" and V ~= nil and not D._NyxReg then
                D._NyxReg = true
                local Col = D.SkyColor or Color3.fromRGB(100, 148, 237)
                _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                    Cmd   = "SetSkybox",
                    Color = { R = Col.R or 0, G = Col.G or 0, B = Col.B or 0 },
                }
            elseif K == "SkyColor" and D._NyxReg then
                local Col = V or Color3.fromRGB(100, 148, 237)
                _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                    Cmd   = "SetSkybox",
                    Color = { R = Col.R or 0, G = Col.G or 0, B = Col.B or 0 },
                }
            end
        end,
    })
end

local function _MakeDirectionalLightInstance()
    local D = {
        _ClassName = "DirectionalLight",
        Color      = Color3.new(1, 1, 1),
        Brightness = 1.0,
        Position   = Vector3.new(5, 10, 5),
    }
    return setmetatable({}, {
        __index    = D,
        __newindex = function(_, K, V)
            rawset(D, K, V)
            if K == "Parent" and V ~= nil and not D._NyxReg then
                D._NyxReg = true
                local Pos = D.Position or Vector3.new(5, 10, 5)
                local Col = D.Color    or Color3.new(1, 1, 1)
                _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                    Cmd       = "AddLight",
                    LightType = "Directional",
                    Position  = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
                    Color     = { R = Col.R, G = Col.G, B = Col.B },
                    Intensity = D.Brightness or 1.0,
                }
            end
        end,
    })
end

local function _MakeSpotLightInstance()
    local D = {
        _ClassName = "SpotLight",
        Color      = Color3.new(1, 1, 1),
        Brightness = 3.0,
        Range      = 20,
        Angle      = 45,
    }
    return setmetatable({}, {
        __index    = D,
        __newindex = function(_, K, V)
            rawset(D, K, V)
            if K == "Parent" and V ~= nil and not D._NyxReg then
                D._NyxReg = true
                local Pos = (type(V) == "table" and V.Position) or Vector3.new(0, 5, 0)
                local Col = D.Color or Color3.new(1, 1, 1)
                _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                    Cmd       = "AddLight",
                    LightType = "Point",
                    Position  = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
                    Color     = { R = Col.R, G = Col.G, B = Col.B },
                    Intensity = D.Brightness or 3.0,
                }
            end
        end,
    })
end

local function _MakeModelInstance()
    local D = { _ClassName = "Model", Name = "Model", _children = {} }
    local Proxy = setmetatable({}, {
        __index    = D,
        __newindex = function(_, K, V) rawset(D, K, V) end,
    })
    function Proxy:IsA(ClassName)
        return ClassName == "Model" or ClassName == "PVInstance" or ClassName == "Instance"
    end
    function Proxy:GetChildren()    return D._children end
    function Proxy:FindFirstChild(Name)
        for _, C in ipairs(D._children) do
            if C.Name == Name then return C end
        end
        return nil
    end
    function Proxy:WaitForChild(Name, _) return self:FindFirstChild(Name) end
    function Proxy:Destroy() end
    return Proxy
end

PointLight = {}

function PointLight.new()
    local D = {
        _ClassName = "PointLight",
        Color      = Color3.new(1, 1, 1),
        Brightness = 3,
        Range      = 20,
    }
    return setmetatable({}, {
        __index    = D,
        __newindex = function(_, K, V)
            rawset(D, K, V)
            if K == "Parent" and V ~= nil and not D._NyxReg then
                D._NyxReg = true
                local Pos = (type(V) == "table" and V.Position) or Vector3.new(0, 5, 0)
                local Col = D.Color or Color3.new(1, 1, 1)
                _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                    Cmd       = "AddLight",
                    LightType = "Point",
                    Position  = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
                    Color     = { R = Col.R, G = Col.G, B = Col.B },
                    Intensity = D.Brightness or 3.0,
                }
            end
        end,
    })
end

do
    local _PartNew = Part.new
    function Part.new()
        local D = _PartNew()
        return setmetatable({}, {
            __index    = D,
            __newindex = function(_, K, V)
                if K == "BrickColor" and type(V) == "table" and V.Color then
                    rawset(D, "Color", V.Color)
                end
                rawset(D, K, V)
                if _NyxTouchesPhysics(K) then
                    D._NyxPhysicsTouched = D._NyxPhysicsTouched or {}
                    D._NyxPhysicsTouched[K] = true
                end
                if K == "Parent" and V == workspace and not D._NyxReg then
                    D._NyxReg = true
                    workspace:AddPart(D)
                elseif D._NyxReg then
                    _NyxApplyPartProperty(D, K, V)
                end
            end,
        })
    end
end

TweenInfo = {}
TweenInfo.__index = TweenInfo

function TweenInfo.new(Time, EasingStyle, EasingDirection, RepeatCount, Reverses, DelayTime)
    return setmetatable({
        Time            = Time            or 1,
        EasingStyle     = EasingStyle     or Enum.EasingStyle.Linear,
        EasingDirection = EasingDirection or Enum.EasingDirection.Out,
        RepeatCount     = RepeatCount     or 0,
        Reverses        = Reverses        and true or false,
        DelayTime       = DelayTime       or 0,
    }, TweenInfo)
end

local function _NyxEaseIn(Alpha, Style)
    if Style == Enum.EasingStyle.Linear      then return Alpha end
    if Style == Enum.EasingStyle.Sine        then return 1 - math.cos((Alpha * math.pi) / 2) end
    if Style == Enum.EasingStyle.Quad        then return Alpha * Alpha end
    if Style == Enum.EasingStyle.Cubic       then return Alpha * Alpha * Alpha end
    if Style == Enum.EasingStyle.Quart       then return Alpha * Alpha * Alpha * Alpha end
    if Style == Enum.EasingStyle.Quint       then return Alpha * Alpha * Alpha * Alpha * Alpha end
    if Style == Enum.EasingStyle.Exponential then
        return Alpha == 0 and 0 or (2 ^ (10 * Alpha - 10))
    end
    if Style == Enum.EasingStyle.Circular then
        return 1 - math.sqrt(math.max(0, 1 - Alpha * Alpha))
    end
    if Style == Enum.EasingStyle.Back then
        local C1 = 1.70158
        local C3 = C1 + 1
        return C3 * Alpha * Alpha * Alpha - C1 * Alpha * Alpha
    end
    if Style == Enum.EasingStyle.Elastic then
        if Alpha == 0 then return 0 end
        if Alpha == 1 then return 1 end
        local C4 = (2 * math.pi) / 3
        return -(2 ^ (10 * Alpha - 10)) * math.sin((Alpha * 10 - 10.75) * C4)
    end
    if Style == Enum.EasingStyle.Bounce then
        return 1 - _NyxBounceOut(1 - Alpha)
    end
    return Alpha
end

function _NyxBounceOut(Alpha)
    local N1 = 7.5625
    local D1 = 2.75
    if Alpha < 1 / D1 then
        return N1 * Alpha * Alpha
    elseif Alpha < 2 / D1 then
        Alpha = Alpha - 1.5 / D1
        return N1 * Alpha * Alpha + 0.75
    elseif Alpha < 2.5 / D1 then
        Alpha = Alpha - 2.25 / D1
        return N1 * Alpha * Alpha + 0.9375
    else
        Alpha = Alpha - 2.625 / D1
        return N1 * Alpha * Alpha + 0.984375
    end
end

local function _NyxEase(Alpha, Style, Direction)
    Alpha = math.max(0, math.min(1, Alpha))
    if Direction == Enum.EasingDirection.Out then
        if Style == Enum.EasingStyle.Bounce then return _NyxBounceOut(Alpha) end
        return 1 - _NyxEaseIn(1 - Alpha, Style)
    end
    if Direction == Enum.EasingDirection.InOut then
        if Alpha < 0.5 then
            return _NyxEaseIn(Alpha * 2, Style) / 2
        end
        if Style == Enum.EasingStyle.Bounce then
            return (1 + _NyxBounceOut(Alpha * 2 - 1)) / 2
        end
        return 1 - _NyxEaseIn((1 - Alpha) * 2, Style) / 2
    end
    return _NyxEaseIn(Alpha, Style)
end

local function _NyxLerp(A, B, Alpha)
    local MT = getmetatable(B)
    if type(A) == "number" and type(B) == "number" then return A + (B - A) * Alpha end
    if MT == Vector3 then
        return Vector3.new(
            _NyxLerp(A.X or 0, B.X or 0, Alpha),
            _NyxLerp(A.Y or 0, B.Y or 0, Alpha),
            _NyxLerp(A.Z or 0, B.Z or 0, Alpha))
    end
    if MT == Color3 then
        return Color3.new(
            _NyxLerp(A.R or 0, B.R or 0, Alpha),
            _NyxLerp(A.G or 0, B.G or 0, Alpha),
            _NyxLerp(A.B or 0, B.B or 0, Alpha))
    end
    if MT == CFrame then
        return CFrame.new(
            _NyxLerp(A.X  or 0, B.X  or 0, Alpha),
            _NyxLerp(A.Y  or 0, B.Y  or 0, Alpha),
            _NyxLerp(A.Z  or 0, B.Z  or 0, Alpha))
            * CFrame.Angles(
                _NyxLerp(A.RX or 0, B.RX or 0, Alpha),
                _NyxLerp(A.RY or 0, B.RY or 0, Alpha),
                _NyxLerp(A.RZ or 0, B.RZ or 0, Alpha))
    end
    return Alpha >= 1 and B or A
end

TweenService = {}

function TweenService:Create(Target, Info, Goals)
    Info  = Info  or TweenInfo.new(1)
    Goals = Goals or {}
    local Starts = {}
    for K in pairs(Goals) do Starts[K] = Target[K] end

    local _CompletedCallbacks = {}
    local _Completed = {
        Connect = function(_, Fn)
            _CompletedCallbacks[#_CompletedCallbacks + 1] = Fn
            return { Disconnect = function() end }
        end,
        Wait = function() end,
    }

    local Tween = {}

    Tween.Completed       = _Completed
    Tween.PlaybackState   = "Begin"

    function Tween:Play()
        local Duration    = math.max(Info.Time or 1, 0.0001)
        local LocalTime   = (_NYX_LIVE_TIME or 0) - (Info.DelayTime or 0)
        if LocalTime < 0 then
            self.PlaybackState = "Delayed"
            return
        end
        local RepeatCount = Info.RepeatCount or 0
        local Cycle       = math.floor(LocalTime / Duration)
        local Done        = RepeatCount >= 0 and Cycle > RepeatCount
        if Done then
            LocalTime = Duration
            Cycle     = RepeatCount
        end
        local Alpha = (LocalTime % Duration) / Duration
        if RepeatCount >= 0 and Cycle == RepeatCount and LocalTime >= Duration then
            Alpha = 1
        end
        if Info.Reverses and Cycle % 2 == 1 then Alpha = 1 - Alpha end
        Alpha = _NyxEase(Alpha, Info.EasingStyle, Info.EasingDirection)
        self.PlaybackState = (Alpha >= 1 and not Info.Reverses) and "Completed" or "Playing"
        for K, V in pairs(Goals) do Target[K] = _NyxLerp(Starts[K], V, Alpha) end
        if self.PlaybackState == "Completed" then
            for _, Fn in ipairs(_CompletedCallbacks) do
                pcall(Fn, "Completed")
            end
        end
    end

    function Tween:Cancel() self.PlaybackState = "Cancelled" end
    function Tween:Pause()  self.PlaybackState = "Paused"    end

    return Tween
end

RunService = {}
RunService.Heartbeat    = {}
RunService.RenderStepped = RunService.Heartbeat

function RunService.Heartbeat:Connect(Callback)
    _NYX_HEARTBEAT_CALLBACKS[#_NYX_HEARTBEAT_CALLBACKS + 1] = Callback
    return { Disconnect = function() end }
end

function _nyx_step_live(DeltaTime)
    for _, Callback in ipairs(_NYX_HEARTBEAT_CALLBACKS) do
        Callback(DeltaTime or 0)
    end
end

Instance = {}

function Instance.new(ClassName)
    if ClassName == "Part" then return Part.new() end
    if ClassName == "PointLight" then return PointLight.new() end
    if ClassName == "Sky" then return _MakeSkyInstance() end
    if ClassName == "DirectionalLight" then return _MakeDirectionalLightInstance() end
    if ClassName == "SpotLight" then return _MakeSpotLightInstance() end
    if ClassName == "Model" then return _MakeModelInstance() end
    local D = { _ClassName = ClassName, Name = ClassName }
    return setmetatable({}, {
        __index = function(_, K)
            if K == "IsA" then return function(_, CN) return CN == ClassName or CN == "Instance" end end
            if K == "Destroy" then return function() end end
            if K == "GetChildren" then return function() return {} end end
            if K == "FindFirstChild" then return function() return nil end end
            if K == "WaitForChild" then return function() return nil end end
            return rawget(D, K)
        end,
        __newindex = function(_, K, V) rawset(D, K, V) end,
    })
end

Lighting = _LightingService

game = { Workspace = workspace, workspace = workspace }

function game:GetService(Name)
    if Name == "Workspace"    or Name == "workspace"   then return workspace         end
    if Name == "Lighting"                              then return _LightingService  end
    if Name == "TweenService"                          then return TweenService      end
    if Name == "RunService"                            then return RunService        end
    if Name == "Players"                               then return {}                end
    return {}
end
