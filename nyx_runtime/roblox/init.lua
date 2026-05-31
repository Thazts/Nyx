-- Nyx Engine — Roblox Runtime Shim
_NYX_COMMANDS = {}

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
            for I = 1, N do
                Parts[I] = _nyx_json_val(V[I], Depth + 1)
            end
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

Enum.PartType = MakeEnum({ "Block", "Sphere", "Cylinder" })

local _NYX_PART_ID = 0

Part = {}
Part.__index = Part

function Part.new()
    _NYX_PART_ID = _NYX_PART_ID + 1
    return setmetatable({
        _id          = "Part_" .. _NYX_PART_ID,
        Name         = "Part",
        Color        = Color3.fromRGB(163, 162, 165),
        Size         = Vector3.new(4, 1.2, 2),
        Position     = Vector3.new(0, 0.6, 0),
        CFrame       = CFrame.new(0, 0.6, 0),
        Anchored     = false,
        CanCollide   = true,
        Transparency = 0,
        Reflectance  = 0,
        Material     = "SmoothPlastic",
        Shape        = "Block",
        CastShadow   = true,
    }, Part)
end

BasePart = Part

workspace = { Gravity = 196.2 }

function workspace:AddPart(P)
    if not P or not P._id then
        print("warning: workspace:AddPart() received an invalid Part")
        return
    end
    local Pos = P.Position or Vector3.new(0, 0, 0)
    local Siz = P.Size     or Vector3.new(4, 1.2, 2)
    local Col = P.Color    or Color3.fromRGB(163, 162, 165)
    local CF  = P.CFrame   or CFrame.new(Pos.X, Pos.Y, Pos.Z)
    _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
        Cmd          = "AddPart",
        Id           = P._id,
        Name         = P.Name or P._id,
        Position     = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
        Size         = { X = Siz.X, Y = Siz.Y, Z = Siz.Z },
        Color        = { R = Col.R, G = Col.G, B = Col.B },
        CFrame       = { X = CF.X, Y = CF.Y, Z = CF.Z, RX = CF.RX or 0, RY = CF.RY or 0, RZ = CF.RZ or 0 },
        Anchored     = P.Anchored    and true or false,
        CanCollide   = P.CanCollide  and true or false,
        Transparency = P.Transparency or 0,
        Material     = tostring(P.Material or "SmoothPlastic"),
        Shape        = tostring(P.Shape or "Block"),
    }
end

function workspace:AddParts(...)
    for _, P in ipairs({...}) do self:AddPart(P) end
end

function workspace:SetGravity(Value)
    _NYX_COMMANDS[#_NYX_COMMANDS + 1] = { Cmd = "SetGravity", Value = Value or 196.2 }
end

function workspace:SetSkybox(Color)
    if Color then
        _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
            Cmd   = "SetSkybox",
            Color = { R = Color.R or 0.39, G = Color.G or 0.58, B = Color.B or 0.93 },
        }
    end
end

local Lighting = {}

function Lighting:AddDirectionalLight(Props)
    Props = Props or {}
    local Pos = Props.Position or Vector3.new(5, 10, 5)
    local Col = Props.Color    or Color3.new(1, 1, 1)
    _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
        Cmd       = "AddLight",
        LightType = "Directional",
        Position  = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
        Color     = { R = Col.R, G = Col.G, B = Col.B },
        Intensity = Props.Intensity or 1.0,
    }
end

function Lighting:AddPointLight(Props)
    Props = Props or {}
    local Pos = Props.Position or Vector3.new(0, 5, 0)
    local Col = Props.Color    or Color3.new(1, 1, 1)
    _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
        Cmd       = "AddLight",
        LightType = "Point",
        Position  = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
        Color     = { R = Col.R, G = Col.G, B = Col.B },
        Intensity = Props.Intensity or 1.0,
    }
end

Camera = {}

function Camera:SetPosition(Pos, LookAt)
    Pos    = Pos    or Vector3.new(10, 10, 10)
    LookAt = LookAt or Vector3.new(0, 0, 0)
    _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
        Cmd      = "SetCamera",
        Position = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
        LookAt   = { X = LookAt.X, Y = LookAt.Y, Z = LookAt.Z },
    }
end

Scene = {}
Scene.__index = Scene

function Scene.new()
    return setmetatable({ _parts = {} }, Scene)
end

function Scene:Add(P)
    workspace:AddPart(P)
    self._parts[#self._parts + 1] = P
    return P
end

function Scene:AddMany(...)
    for _, P in ipairs({...}) do self:Add(P) end
end

function Scene:SetGravity(Value) workspace:SetGravity(Value) end
function Scene:SetSkybox(Color)  workspace:SetSkybox(Color)  end

function Scene:AddLight(LightType, Props)
    if LightType == "Directional" then Lighting:AddDirectionalLight(Props)
    elseif LightType == "Point"   then Lighting:AddPointLight(Props)
    end
end

do
    local _PartNew = Part.new
    function Part.new()
        local _D = _PartNew()
        return setmetatable({}, {
            __index    = _D,
            __newindex = function(_, K, V)
                rawset(_D, K, V)
                if K == "Parent" and V == workspace and not _D._NyxReg then
                    _D._NyxReg = true
                    workspace:AddPart(_D)
                end
            end,
        })
    end
end
PointLight = {}

function PointLight.new()
    local _D = { Color = Color3.new(1, 1, 1), Brightness = 3, Range = 20 }
    return setmetatable({}, {
        __index    = _D,
        __newindex = function(_, K, V)
            rawset(_D, K, V)
            if K == "Parent" and V ~= nil and not _D._NyxReg then
                _D._NyxReg = true
                local Pos = (type(V) == "table" and V.Position) or Vector3.new(0, 5, 0)
                local Col = _D.Color or Color3.new(1, 1, 1)
                _NYX_COMMANDS[#_NYX_COMMANDS + 1] = {
                    Cmd       = "AddLight",
                    LightType = "Point",
                    Position  = { X = Pos.X, Y = Pos.Y, Z = Pos.Z },
                    Color     = { R = Col.R, G = Col.G, B = Col.B },
                    Intensity = _D.Brightness or 3.0,
                }
            end
        end,
    })
end

Instance = {}
function Instance.new(ClassName)
    if ClassName == "Part"       then return Part.new()       end
    if ClassName == "PointLight" then return PointLight.new() end
    return setmetatable({}, { __newindex = rawset })
end

game = { Workspace = workspace, workspace = workspace }

function game:GetService(Name)
    if Name == "Workspace" or Name == "workspace" then return workspace end
    if Name == "Lighting"  then return Lighting   end
    if Name == "Players"   then return {}         end
    return {}
end
