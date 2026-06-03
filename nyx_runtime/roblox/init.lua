-- Nyx Engine — Roblox Runtime Shim
_NYX_COMMANDS = {}
_NYX_LIVE_TIME = _NYX_LIVE_TIME or 0
_NYX_HEARTBEAT_CALLBACKS = {}

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
Enum.EasingStyle = MakeEnum({ "Linear", "Sine", "Quad" })
Enum.EasingDirection = MakeEnum({ "In", "Out", "InOut" })

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
    if K == "Position" then C.Position = _NyxVec(V); C.CFrame.X = V.X or 0; C.CFrame.Y = V.Y or 0; C.CFrame.Z = V.Z or 0 end
    if K == "Size" then C.Size = _NyxVec(V) end
    if K == "Color" then C.Color = _NyxColor(V) end
    if K == "CFrame" then C.CFrame = _NyxFrame(V); C.Position = { X = V.X or 0, Y = V.Y or 0, Z = V.Z or 0 } end
    if K == "AssemblyLinearVelocity" then C.AssemblyLinearVelocity = _NyxVec(V); C.Velocity = _NyxVec(V) end
    if K == "Velocity" then C.Velocity = _NyxVec(V); C.AssemblyLinearVelocity = _NyxVec(V) end
    if K == "AssemblyAngularVelocity" then C.AssemblyAngularVelocity = _NyxVec(V); C.RotVelocity = _NyxVec(V) end
    if K == "RotVelocity" then C.RotVelocity = _NyxVec(V); C.AssemblyAngularVelocity = _NyxVec(V) end
    if K == "Force" then C.Force = _NyxVec(V) end
    if K == "Impulse" then C.Impulse = _NyxVec(V) end
    if K == "Transparency" then C.Transparency = V or 0 end
    if K == "Material" then C.Material = tostring(V or "SmoothPlastic") end
    if K == "Shape" then C.Shape = tostring(V or "Block") end
    if K == "Anchored" then C.Anchored = V and true or false end
    if K == "CanCollide" then C.CanCollide = V and true or false end
    if K == "Massless" then C.Massless = V and true or false end
    if K == "Mass" then C.Mass = V or 1 end
    if K == "Density" then C.Density = V or 1 end
    if K == "Friction" then C.Friction = V or 0.3 end
    if K == "Elasticity" then C.Elasticity = V or 0 end
end

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
    }, Part)
end

function Part:GetMass()
    if self.Mass then return self.Mass end
    local S = self.Size or Vector3.new(4, 1.2, 2)
    local Density = self.Density or 0.7
    return math.max((S.X or 1) * (S.Y or 1) * (S.Z or 1) * Density, 0.001)
end

function Part:ApplyImpulse(Impulse)
    Impulse = Impulse or Vector3.zero
    local Mass = self:GetMass()
    self.AssemblyLinearVelocity = (self.AssemblyLinearVelocity or self.Velocity or Vector3.zero) + (Impulse * (1 / Mass))
    self.Impulse = (self.Impulse or Vector3.zero) + Impulse
    self._NyxPhysicsTouched = self._NyxPhysicsTouched or {}
    self._NyxPhysicsTouched.AssemblyLinearVelocity = true
    self._NyxPhysicsTouched.Impulse = true
end

function Part:ApplyForce(Force)
    self.Force = (self.Force or Vector3.zero) + (Force or Vector3.zero)
    self._NyxPhysicsTouched = self._NyxPhysicsTouched or {}
    self._NyxPhysicsTouched.Force = true
end

function Part:SetNetworkOwner(_) end

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
    local Lin = P.AssemblyLinearVelocity or P.Velocity or Vector3.zero
    local Ang = P.AssemblyAngularVelocity or P.RotVelocity or Vector3.zero
    local Force = P.Force or Vector3.zero
    local Impulse = P.Impulse or Vector3.zero
    local Touched = P._NyxPhysicsTouched or {}
    -- { Cmd, Id, Name, Position, Size, Color, CFrame, Anchored, CanCollide, Transparency, Material, Shape }
    local Command = {
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
    if Touched.AssemblyLinearVelocity or Touched.Velocity or _NyxNonZeroVec(Lin) then
        Command.AssemblyLinearVelocity = { X = Lin.X or 0, Y = Lin.Y or 0, Z = Lin.Z or 0 }
        Command.Velocity = { X = Lin.X or 0, Y = Lin.Y or 0, Z = Lin.Z or 0 }
    end
    if Touched.AssemblyAngularVelocity or Touched.RotVelocity or _NyxNonZeroVec(Ang) then
        Command.AssemblyAngularVelocity = { X = Ang.X or 0, Y = Ang.Y or 0, Z = Ang.Z or 0 }
        Command.RotVelocity = { X = Ang.X or 0, Y = Ang.Y or 0, Z = Ang.Z or 0 }
    end
    if Touched.Force or _NyxNonZeroVec(Force) then
        Command.Force = { X = Force.X or 0, Y = Force.Y or 0, Z = Force.Z or 0 }
    end
    if Touched.Impulse or _NyxNonZeroVec(Impulse) then
        Command.Impulse = { X = Impulse.X or 0, Y = Impulse.Y or 0, Z = Impulse.Z or 0 }
    end
    if Touched.Massless or P.Massless then Command.Massless = P.Massless and true or false end
    if Touched.Mass and P.Mass ~= nil then Command.Mass = P.Mass end
    if Touched.Density and P.Density ~= nil then Command.Density = P.Density end
    if Touched.Friction and P.Friction ~= nil then Command.Friction = P.Friction end
    if Touched.Elasticity and P.Elasticity ~= nil then Command.Elasticity = P.Elasticity end
    _NYX_COMMANDS[#_NYX_COMMANDS + 1] = Command
    P._NyxCommand = Command
    P._NyxReg = true
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
                if _NyxTouchesPhysics(K) then
                    _D._NyxPhysicsTouched = _D._NyxPhysicsTouched or {}
                    _D._NyxPhysicsTouched[K] = true
                end
                if K == "Parent" and V == workspace and not _D._NyxReg then
                    _D._NyxReg = true
                    workspace:AddPart(_D)
                elseif _D._NyxReg then
                    _NyxApplyPartProperty(_D, K, V)
                end
            end,
        })
    end
end
TweenInfo = {}
TweenInfo.__index = TweenInfo

function TweenInfo.new(Time, EasingStyle, EasingDirection, RepeatCount, Reverses, DelayTime)
    return setmetatable({
        Time = Time or 1,
        EasingStyle = EasingStyle or Enum.EasingStyle.Linear,
        EasingDirection = EasingDirection or Enum.EasingDirection.Out,
        RepeatCount = RepeatCount or 0,
        Reverses = Reverses and true or false,
        DelayTime = DelayTime or 0,
    }, TweenInfo)
end

local function _NyxEase(Alpha, Style, Direction)
    Alpha = math.max(0, math.min(1, Alpha))
    if Direction == Enum.EasingDirection.Out then return 1 - _NyxEase(1 - Alpha, Style, Enum.EasingDirection.In) end
    if Direction == Enum.EasingDirection.InOut then
        if Alpha < 0.5 then return _NyxEase(Alpha * 2, Style, Enum.EasingDirection.In) / 2 end
        return 0.5 + _NyxEase((Alpha - 0.5) * 2, Style, Enum.EasingDirection.Out) / 2
    end
    if Style == Enum.EasingStyle.Sine then return 1 - math.cos((Alpha * math.pi) / 2) end
    if Style == Enum.EasingStyle.Quad then return Alpha * Alpha end
    return Alpha
end

local function _NyxLerp(A, B, Alpha)
    local MT = getmetatable(B)
    if type(A) == "number" and type(B) == "number" then return A + (B - A) * Alpha end
    if MT == Vector3 then return Vector3.new(_NyxLerp(A.X or 0, B.X or 0, Alpha), _NyxLerp(A.Y or 0, B.Y or 0, Alpha), _NyxLerp(A.Z or 0, B.Z or 0, Alpha)) end
    if MT == Color3 then return Color3.new(_NyxLerp(A.R or 0, B.R or 0, Alpha), _NyxLerp(A.G or 0, B.G or 0, Alpha), _NyxLerp(A.B or 0, B.B or 0, Alpha)) end
    if MT == CFrame then return CFrame.new(_NyxLerp(A.X or 0, B.X or 0, Alpha), _NyxLerp(A.Y or 0, B.Y or 0, Alpha), _NyxLerp(A.Z or 0, B.Z or 0, Alpha)) * CFrame.Angles(_NyxLerp(A.RX or 0, B.RX or 0, Alpha), _NyxLerp(A.RY or 0, B.RY or 0, Alpha), _NyxLerp(A.RZ or 0, B.RZ or 0, Alpha)) end
    return Alpha >= 1 and B or A
end

TweenService = {}

function TweenService:Create(Target, Info, Goals)
    Info = Info or TweenInfo.new(1)
    Goals = Goals or {}
    local Starts = {}
    for K in pairs(Goals) do Starts[K] = Target[K] end
    return {
        Play = function()
            local Duration = math.max(Info.Time or 1, 0.0001)
            local LocalTime = (_NYX_LIVE_TIME or 0) - (Info.DelayTime or 0)
            if LocalTime < 0 then return end
            local Cycle = math.floor(LocalTime / Duration)
            local RepeatCount = Info.RepeatCount or 0
            if RepeatCount >= 0 and Cycle > RepeatCount then LocalTime = Duration; Cycle = RepeatCount end
            local Alpha = (LocalTime % Duration) / Duration
            if RepeatCount >= 0 and Cycle == RepeatCount and LocalTime >= Duration then Alpha = 1 end
            if Info.Reverses and Cycle % 2 == 1 then Alpha = 1 - Alpha end
            Alpha = _NyxEase(Alpha, Info.EasingStyle, Info.EasingDirection)
            for K, V in pairs(Goals) do Target[K] = _NyxLerp(Starts[K], V, Alpha) end
        end,
        Cancel = function() end,
        Pause = function() end,
    }
end

RunService = {}
RunService.Heartbeat = {}
RunService.RenderStepped = RunService.Heartbeat

function RunService.Heartbeat:Connect(Callback)
    _NYX_HEARTBEAT_CALLBACKS[#_NYX_HEARTBEAT_CALLBACKS + 1] = Callback
    return { Disconnect = function() end }
end

function _nyx_step_live(DeltaTime)
    for _, Callback in ipairs(_NYX_HEARTBEAT_CALLBACKS) do Callback(DeltaTime or 0) end
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
    if Name == "TweenService" then return TweenService end
    if Name == "RunService" then return RunService end
    if Name == "Players"   then return {}         end
    return {}
end
