-- Nyx Engine — Roblox Runtime Shim
-- A semi-complete Roblox/Luau API emulation layer running on Lua 5.4 (mlua).
--
-- Two jobs:
--   1. Emit render commands the wgpu viewport understands (AddPart, AddLight,
--      SetCamera, SetSkybox, SetGravity) into the global _NYX_COMMANDS list.
--   2. Provide a broad enough Roblox API surface that real scripts execute
--      without `attempt to call a nil value` crashes, even when nothing visual
--      results from a given call.
--
-- NOTE: the underlying VM is Lua 5.4, not Luau. Luau-only *syntax* (type
-- annotations `local x: number`, `continue`, compound assignment `+=`) cannot
-- be parsed here — that is a VM limitation, not an API gap. This shim covers the
-- API/datatype/library surface, which is what most simple scene scripts use.

_NYX_COMMANDS = {}
_NYX_LIVE_TIME = _NYX_LIVE_TIME or 0
_NYX_HEARTBEAT_CALLBACKS = {}

-- ── Lua 5.4 / Luau compatibility shims ───────────────────────────────────────

if not math.pow then
    math.pow = function(Base, Exp) return Base ^ Exp end
end
if not math.atan2 then
    math.atan2 = function(Y, X) return math.atan(Y, X) end
end
if not math.clamp then
    math.clamp = function(N, Lo, Hi)
        if N < Lo then return Lo end
        if N > Hi then return Hi end
        return N
    end
end
if not math.sign then
    math.sign = function(N) return (N > 0 and 1) or (N < 0 and -1) or 0 end
end
if not math.round then
    math.round = function(N) return math.floor(N + 0.5) end
end

-- Luau table extensions used by many scripts.
if not table.find then
    function table.find(T, Value, Init)
        for I = (Init or 1), #T do
            if T[I] == Value then return I end
        end
        return nil
    end
end
if not table.create then
    function table.create(Count, Value)
        local T = {}
        for I = 1, Count do T[I] = Value end
        return T
    end
end
if not table.clear then
    function table.clear(T)
        for K in pairs(T) do T[K] = nil end
    end
end
if not table.clone then
    function table.clone(T)
        local C = {}
        for K, V in pairs(T) do C[K] = V end
        return C
    end
end
if not table.freeze then
    function table.freeze(T) return T end
end
if not table.isfrozen then
    function table.isfrozen(_T) return false end
end
if not string.split then
    function string.split(S, Sep)
        Sep = Sep or ","
        local Out = {}
        if Sep == "" then
            for I = 1, #S do Out[I] = S:sub(I, I) end
            return Out
        end
        local Start = 1
        while true do
            local A, B = S:find(Sep, Start, true)
            if not A then
                Out[#Out + 1] = S:sub(Start)
                break
            end
            Out[#Out + 1] = S:sub(Start, A - 1)
            Start = B + 1
        end
        return Out
    end
end

-- Override os.clock for the Nyx re-run-per-tick model. Every tick re-runs the
-- whole script, so a module-scope `local t = os.clock()` would recapture the CPU
-- clock each tick and freeze time-based animation. First call returns 0 (the
-- scene-start origin); later calls return _NYX_LIVE_TIME.
if os and os.clock then
    local _NyxClockFirst = true
    local _RealClock = os.clock
    os.clock = function()
        if _NyxClockFirst then
            _NyxClockFirst = false
            return 0
        end
        return _NYX_LIVE_TIME or 0
    end
    _NYX_REAL_CLOCK = _RealClock
end

-- ── JSON encoding (used by HttpService + diagnostics) ─────────────────────────

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

-- Minimal JSON decode for HttpService:JSONDecode.
local function _nyx_json_decode(Str)
    local Pos = 1
    local Parse
    local function Skip()
        while Pos <= #Str and Str:sub(Pos, Pos):match("%s") do Pos = Pos + 1 end
    end
    local function ParseString()
        Pos = Pos + 1
        local Buf = {}
        while Pos <= #Str do
            local C = Str:sub(Pos, Pos)
            if C == '"' then Pos = Pos + 1; return table.concat(Buf) end
            if C == "\\" then
                local N = Str:sub(Pos + 1, Pos + 1)
                local Map = { n = "\n", t = "\t", r = "\r", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
                Buf[#Buf + 1] = Map[N] or N
                Pos = Pos + 2
            else
                Buf[#Buf + 1] = C
                Pos = Pos + 1
            end
        end
        error("unterminated string in JSON")
    end
    Parse = function()
        Skip()
        local C = Str:sub(Pos, Pos)
        if C == '"' then return ParseString() end
        if C == "{" then
            Pos = Pos + 1
            local Obj = {}
            Skip()
            if Str:sub(Pos, Pos) == "}" then Pos = Pos + 1; return Obj end
            while true do
                Skip()
                local Key = ParseString()
                Skip(); Pos = Pos + 1 -- skip ':'
                Obj[Key] = Parse()
                Skip()
                local D = Str:sub(Pos, Pos)
                Pos = Pos + 1
                if D == "}" then break end
            end
            return Obj
        end
        if C == "[" then
            Pos = Pos + 1
            local Arr = {}
            Skip()
            if Str:sub(Pos, Pos) == "]" then Pos = Pos + 1; return Arr end
            while true do
                Arr[#Arr + 1] = Parse()
                Skip()
                local D = Str:sub(Pos, Pos)
                Pos = Pos + 1
                if D == "]" then break end
            end
            return Arr
        end
        local Rest = Str:sub(Pos)
        if Rest:sub(1, 4) == "true" then Pos = Pos + 4; return true end
        if Rest:sub(1, 5) == "false" then Pos = Pos + 5; return false end
        if Rest:sub(1, 4) == "null" then Pos = Pos + 4; return nil end
        local NumStr = Rest:match("^%-?%d+%.?%d*[eE]?[%+%-]?%d*")
        if NumStr and NumStr ~= "" then
            Pos = Pos + #NumStr
            return tonumber(NumStr)
        end
        error("unexpected JSON token at " .. Pos)
    end
    return Parse()
end

-- ── Signal (RBXScriptSignal) ─────────────────────────────────────────────────
-- Synchronous model: Fire invokes handlers immediately; Wait cannot truly yield
-- under the re-run-per-tick runner, so it returns immediately.

local Signal = {}
Signal.__index = Signal

local function _NyxNewSignal()
    return setmetatable({ _handlers = {} }, Signal)
end

function Signal:Connect(Fn)
    local Conn = { Connected = true, _fn = Fn, _signal = self }
    function Conn:Disconnect()
        self.Connected = false
        self._signal._handlers[self] = nil
    end
    Conn.disconnect = Conn.Disconnect
    self._handlers[Conn] = true
    return Conn
end
Signal.connect = Signal.Connect

function Signal:Once(Fn)
    local Conn
    Conn = self:Connect(function(...)
        Conn:Disconnect()
        Fn(...)
    end)
    return Conn
end

function Signal:Wait() return end

function Signal:Fire(...)
    for Conn in pairs(self._handlers) do
        if Conn.Connected then pcall(Conn._fn, ...) end
    end
end
Signal.fire = Signal.Fire
Signal.ConnectParallel = Signal.Connect

-- ── Datatype helpers ─────────────────────────────────────────────────────────

local function _NyxIsType(V, MT) return type(V) == "table" and getmetatable(V) == MT end

-- ── Vector3 ──────────────────────────────────────────────────────────────────

Vector3 = {}
Vector3.__index = function(V, K)
    if K == "Magnitude" then
        return math.sqrt(V.X * V.X + V.Y * V.Y + V.Z * V.Z)
    elseif K == "Unit" then
        local M = math.sqrt(V.X * V.X + V.Y * V.Y + V.Z * V.Z)
        if M == 0 then return Vector3.new(0, 0, 0) end
        return Vector3.new(V.X / M, V.Y / M, V.Z / M)
    end
    return rawget(Vector3, K)
end
Vector3.__tostring = function(V) return V.X .. ", " .. V.Y .. ", " .. V.Z end
Vector3.__add = function(A, B) return Vector3.new(A.X + B.X, A.Y + B.Y, A.Z + B.Z) end
Vector3.__sub = function(A, B) return Vector3.new(A.X - B.X, A.Y - B.Y, A.Z - B.Z) end
Vector3.__mul = function(A, B)
    if type(A) == "number" then return Vector3.new(A * B.X, A * B.Y, A * B.Z) end
    if type(B) == "number" then return Vector3.new(A.X * B, A.Y * B, A.Z * B) end
    return Vector3.new(A.X * B.X, A.Y * B.Y, A.Z * B.Z)
end
Vector3.__div = function(A, B)
    if type(B) == "number" then return Vector3.new(A.X / B, A.Y / B, A.Z / B) end
    return Vector3.new(A.X / B.X, A.Y / B.Y, A.Z / B.Z)
end
Vector3.__unm = function(V) return Vector3.new(-V.X, -V.Y, -V.Z) end
Vector3.__eq  = function(A, B) return A.X == B.X and A.Y == B.Y and A.Z == B.Z end

function Vector3.new(X, Y, Z)
    return setmetatable({ X = X or 0, Y = Y or 0, Z = Z or 0 }, Vector3)
end

function Vector3:Dot(B) return self.X * B.X + self.Y * B.Y + self.Z * B.Z end
function Vector3:Cross(B)
    return Vector3.new(
        self.Y * B.Z - self.Z * B.Y,
        self.Z * B.X - self.X * B.Z,
        self.X * B.Y - self.Y * B.X)
end
function Vector3:Lerp(B, A)
    return Vector3.new(
        self.X + (B.X - self.X) * A,
        self.Y + (B.Y - self.Y) * A,
        self.Z + (B.Z - self.Z) * A)
end
function Vector3:Min(B)
    return Vector3.new(math.min(self.X, B.X), math.min(self.Y, B.Y), math.min(self.Z, B.Z))
end
function Vector3:Max(B)
    return Vector3.new(math.max(self.X, B.X), math.max(self.Y, B.Y), math.max(self.Z, B.Z))
end
function Vector3:Abs() return Vector3.new(math.abs(self.X), math.abs(self.Y), math.abs(self.Z)) end
function Vector3:Ceil() return Vector3.new(math.ceil(self.X), math.ceil(self.Y), math.ceil(self.Z)) end
function Vector3:Floor() return Vector3.new(math.floor(self.X), math.floor(self.Y), math.floor(self.Z)) end
function Vector3:Sign() return Vector3.new(math.sign(self.X), math.sign(self.Y), math.sign(self.Z)) end
function Vector3:FuzzyEq(B, Epsilon)
    Epsilon = Epsilon or 1e-5
    return math.abs(self.X - B.X) <= Epsilon
        and math.abs(self.Y - B.Y) <= Epsilon
        and math.abs(self.Z - B.Z) <= Epsilon
end
function Vector3.FromNormalId(_) return Vector3.new(0, 1, 0) end

Vector3.zero  = Vector3.new(0, 0, 0)
Vector3.one   = Vector3.new(1, 1, 1)
Vector3.xAxis = Vector3.new(1, 0, 0)
Vector3.yAxis = Vector3.new(0, 1, 0)
Vector3.zAxis = Vector3.new(0, 0, 1)

-- ── Vector2 ──────────────────────────────────────────────────────────────────

Vector2 = {}
Vector2.__index = function(V, K)
    if K == "Magnitude" then return math.sqrt(V.X * V.X + V.Y * V.Y) end
    if K == "Unit" then
        local M = math.sqrt(V.X * V.X + V.Y * V.Y)
        if M == 0 then return Vector2.new(0, 0) end
        return Vector2.new(V.X / M, V.Y / M)
    end
    return rawget(Vector2, K)
end
Vector2.__tostring = function(V) return V.X .. ", " .. V.Y end
Vector2.__add = function(A, B) return Vector2.new(A.X + B.X, A.Y + B.Y) end
Vector2.__sub = function(A, B) return Vector2.new(A.X - B.X, A.Y - B.Y) end
Vector2.__mul = function(A, B)
    if type(A) == "number" then return Vector2.new(A * B.X, A * B.Y) end
    if type(B) == "number" then return Vector2.new(A.X * B, A.Y * B) end
    return Vector2.new(A.X * B.X, A.Y * B.Y)
end
Vector2.__div = function(A, B)
    if type(B) == "number" then return Vector2.new(A.X / B, A.Y / B) end
    return Vector2.new(A.X / B.X, A.Y / B.Y)
end
Vector2.__unm = function(V) return Vector2.new(-V.X, -V.Y) end
Vector2.__eq  = function(A, B) return A.X == B.X and A.Y == B.Y end

function Vector2.new(X, Y) return setmetatable({ X = X or 0, Y = Y or 0 }, Vector2) end
function Vector2:Dot(B) return self.X * B.X + self.Y * B.Y end
function Vector2:Cross(B) return self.X * B.Y - self.Y * B.X end
function Vector2:Lerp(B, A)
    return Vector2.new(self.X + (B.X - self.X) * A, self.Y + (B.Y - self.Y) * A)
end
Vector2.zero  = Vector2.new(0, 0)
Vector2.one   = Vector2.new(1, 1)
Vector2.xAxis = Vector2.new(1, 0)
Vector2.yAxis = Vector2.new(0, 1)

-- ── Color3 ───────────────────────────────────────────────────────────────────

Color3 = {}
Color3.__index = Color3
Color3.__tostring = function(C) return C.R .. ", " .. C.G .. ", " .. C.B end
Color3.__eq = function(A, B) return A.R == B.R and A.G == B.G and A.B == B.B end

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
function Color3.fromHSV(H, S, V)
    H, S, V = H or 0, S or 0, V or 0
    local I = math.floor(H * 6)
    local F = H * 6 - I
    local P = V * (1 - S)
    local Q = V * (1 - F * S)
    local T = V * (1 - (1 - F) * S)
    I = I % 6
    if I == 0 then return Color3.new(V, T, P) end
    if I == 1 then return Color3.new(Q, V, P) end
    if I == 2 then return Color3.new(P, V, T) end
    if I == 3 then return Color3.new(P, Q, V) end
    if I == 4 then return Color3.new(T, P, V) end
    return Color3.new(V, P, Q)
end
Color3.fromHSV = Color3.fromHSV
function Color3:ToHSV()
    local R, G, B = self.R, self.G, self.B
    local Max = math.max(R, G, B)
    local Min = math.min(R, G, B)
    local H, S, V = 0, 0, Max
    local D = Max - Min
    if Max ~= 0 then S = D / Max end
    if D ~= 0 then
        if Max == R then H = (G - B) / D % 6
        elseif Max == G then H = (B - R) / D + 2
        else H = (R - G) / D + 4 end
        H = H / 6
    end
    return H, S, V
end
function Color3:Lerp(B, A)
    return Color3.new(
        self.R + (B.R - self.R) * A,
        self.G + (B.G - self.G) * A,
        self.B + (B.B - self.B) * A)
end
function Color3:ToHex()
    local function H(N) return string.format("%02X", math.clamp(math.floor(N * 255 + 0.5), 0, 255)) end
    return H(self.R) .. H(self.G) .. H(self.B)
end

Color3.White = Color3.new(1, 1, 1)
Color3.Black = Color3.new(0, 0, 0)
Color3.Gray  = Color3.fromRGB(163, 162, 165)
Color3.Red   = Color3.fromRGB(255, 0, 0)
Color3.Green = Color3.fromRGB(0, 255, 0)
Color3.Blue  = Color3.fromRGB(0, 0, 255)

CFrame = {}

local function _NyxMakeCFrame(X, Y, Z, M)
    local CF = {
        X = X or 0, Y = Y or 0, Z = Z or 0,
        M00 = M[1], M01 = M[2], M02 = M[3],
        M10 = M[4], M11 = M[5], M12 = M[6],
        M20 = M[7], M21 = M[8], M22 = M[9],
    }
    return setmetatable(CF, CFrame)
end

local _NyxIdentityM = { 1, 0, 0, 0, 1, 0, 0, 0, 1 }

local function _NyxMatMul(A, B)
    return {
        A[1] * B[1] + A[2] * B[4] + A[3] * B[7],
        A[1] * B[2] + A[2] * B[5] + A[3] * B[8],
        A[1] * B[3] + A[2] * B[6] + A[3] * B[9],
        A[4] * B[1] + A[5] * B[4] + A[6] * B[7],
        A[4] * B[2] + A[5] * B[5] + A[6] * B[8],
        A[4] * B[3] + A[5] * B[6] + A[6] * B[9],
        A[7] * B[1] + A[8] * B[4] + A[9] * B[7],
        A[7] * B[2] + A[8] * B[5] + A[9] * B[8],
        A[7] * B[3] + A[8] * B[6] + A[9] * B[9],
    }
end

local function _NyxMatVec(M, X, Y, Z)
    return
        M.M00 * X + M.M01 * Y + M.M02 * Z,
        M.M10 * X + M.M11 * Y + M.M12 * Z,
        M.M20 * X + M.M21 * Y + M.M22 * Z
end

local function _NyxEulerXYZ(CF)
    local Sy = math.clamp(CF.M02, -1, 1)
    local RY = math.asin(Sy)
    local RX, RZ
    if math.abs(CF.M02) < 0.99999 then
        RX = math.atan2(-CF.M12, CF.M22)
        RZ = math.atan2(-CF.M01, CF.M00)
    else
        RX = math.atan2(CF.M21, CF.M11)
        RZ = 0
    end
    return RX, RY, RZ
end

CFrame.__index = function(CF, K)
    if K == "Position" or K == "p" then return Vector3.new(CF.X, CF.Y, CF.Z) end
    if K == "RightVector" then return Vector3.new(CF.M00, CF.M10, CF.M20) end
    if K == "UpVector"    then return Vector3.new(CF.M01, CF.M11, CF.M21) end
    if K == "LookVector"  then return Vector3.new(-CF.M02, -CF.M12, -CF.M22) end
    if K == "XVector"     then return Vector3.new(CF.M00, CF.M10, CF.M20) end
    if K == "YVector"     then return Vector3.new(CF.M01, CF.M11, CF.M21) end
    if K == "ZVector"     then return Vector3.new(CF.M02, CF.M12, CF.M22) end
    if K == "RX" or K == "RY" or K == "RZ" then
        local RX, RY, RZ = _NyxEulerXYZ(CF)
        if K == "RX" then return RX elseif K == "RY" then return RY else return RZ end
    end
    if K == "Rotation" then
        return _NyxMakeCFrame(0, 0, 0,
            { CF.M00, CF.M01, CF.M02, CF.M10, CF.M11, CF.M12, CF.M20, CF.M21, CF.M22 })
    end
    return rawget(CFrame, K)
end
CFrame.__tostring = function(CF)
    return string.format("%g, %g, %g", CF.X, CF.Y, CF.Z)
end
CFrame.__eq = function(A, B)
    return A.X == B.X and A.Y == B.Y and A.Z == B.Z
        and A.M00 == B.M00 and A.M11 == B.M11 and A.M22 == B.M22
end

function CFrame.new(X, Y, Z, ...)
    if X == nil then return _NyxMakeCFrame(0, 0, 0, _NyxIdentityM) end
    if _NyxIsType(X, Vector3) then
        if _NyxIsType(Y, Vector3) then return CFrame.lookAt(X, Y) end
        return _NyxMakeCFrame(X.X, X.Y, X.Z, _NyxIdentityM)
    end
    local Extra = { ... }
    if #Extra >= 9 then
        return _NyxMakeCFrame(X, Y, Z, Extra)
    end
    return _NyxMakeCFrame(X or 0, Y or 0, Z or 0, _NyxIdentityM)
end

function CFrame.fromMatrix(Pos, RightV, UpV, BackV)
    Pos = Pos or Vector3.zero
    RightV = RightV or Vector3.xAxis
    UpV = UpV or Vector3.yAxis
    BackV = BackV or RightV:Cross(UpV)
    return _NyxMakeCFrame(Pos.X, Pos.Y, Pos.Z, {
        RightV.X, UpV.X, BackV.X,
        RightV.Y, UpV.Y, BackV.Y,
        RightV.Z, UpV.Z, BackV.Z,
    })
end

function CFrame.Angles(RX, RY, RZ)
    RX, RY, RZ = RX or 0, RY or 0, RZ or 0
    local Cx, Sx = math.cos(RX), math.sin(RX)
    local Cy, Sy = math.cos(RY), math.sin(RY)
    local Cz, Sz = math.cos(RZ), math.sin(RZ)
    local MX = { 1, 0, 0, 0, Cx, -Sx, 0, Sx, Cx }
    local MY = { Cy, 0, Sy, 0, 1, 0, -Sy, 0, Cy }
    local MZ = { Cz, -Sz, 0, Sz, Cz, 0, 0, 0, 1 }
    local M = _NyxMatMul(_NyxMatMul(MX, MY), MZ)
    return _NyxMakeCFrame(0, 0, 0, M)
end
CFrame.fromEulerAnglesXYZ = CFrame.Angles
CFrame.fromOrientation = CFrame.Angles

function CFrame.fromEulerAnglesYXZ(RX, RY, RZ)
    RX, RY, RZ = RX or 0, RY or 0, RZ or 0
    local Cx, Sx = math.cos(RX), math.sin(RX)
    local Cy, Sy = math.cos(RY), math.sin(RY)
    local Cz, Sz = math.cos(RZ), math.sin(RZ)
    local MX = { 1, 0, 0, 0, Cx, -Sx, 0, Sx, Cx }
    local MY = { Cy, 0, Sy, 0, 1, 0, -Sy, 0, Cy }
    local MZ = { Cz, -Sz, 0, Sz, Cz, 0, 0, 0, 1 }
    local M = _NyxMatMul(_NyxMatMul(MY, MX), MZ)
    return _NyxMakeCFrame(0, 0, 0, M)
end

function CFrame.fromAxisAngle(Axis, Theta)
    Axis = (Axis or Vector3.yAxis).Unit
    local C, S = math.cos(Theta or 0), math.sin(Theta or 0)
    local T = 1 - C
    local X, Y, Z = Axis.X, Axis.Y, Axis.Z
    return _NyxMakeCFrame(0, 0, 0, {
        T * X * X + C,     T * X * Y - S * Z, T * X * Z + S * Y,
        T * X * Y + S * Z, T * Y * Y + C,     T * Y * Z - S * X,
        T * X * Z - S * Y, T * Y * Z + S * X, T * Z * Z + C,
    })
end

function CFrame.lookAt(Eye, Target, Up)
    Eye    = Eye or Vector3.zero
    Target = Target or Vector3.zero
    Up     = Up or Vector3.yAxis
    local Back = (Eye - Target)
    if Back.Magnitude == 0 then Back = Vector3.zAxis else Back = Back.Unit end
    local Right = Up:Cross(Back)
    if Right.Magnitude == 0 then Right = Vector3.xAxis else Right = Right.Unit end
    local NewUp = Back:Cross(Right)
    local CF = _NyxMakeCFrame(Eye.X, Eye.Y, Eye.Z, {
        Right.X, NewUp.X, Back.X,
        Right.Y, NewUp.Y, Back.Y,
        Right.Z, NewUp.Z, Back.Z,
    })
    CF._eye = Eye
    CF._target = Target
    return CF
end

CFrame.__mul = function(A, B)
    if _NyxIsType(B, CFrame) then
        local AM = { A.M00, A.M01, A.M02, A.M10, A.M11, A.M12, A.M20, A.M21, A.M22 }
        local BM = { B.M00, B.M01, B.M02, B.M10, B.M11, B.M12, B.M20, B.M21, B.M22 }
        local M = _NyxMatMul(AM, BM)
        local PX, PY, PZ = _NyxMatVec(A, B.X, B.Y, B.Z)
        return _NyxMakeCFrame(A.X + PX, A.Y + PY, A.Z + PZ, M)
    end
    if _NyxIsType(B, Vector3) then
        local PX, PY, PZ = _NyxMatVec(A, B.X, B.Y, B.Z)
        return Vector3.new(A.X + PX, A.Y + PY, A.Z + PZ)
    end
    return A
end
CFrame.__add = function(A, V)
    return _NyxMakeCFrame(A.X + V.X, A.Y + V.Y, A.Z + V.Z,
        { A.M00, A.M01, A.M02, A.M10, A.M11, A.M12, A.M20, A.M21, A.M22 })
end
CFrame.__sub = function(A, V)
    return _NyxMakeCFrame(A.X - V.X, A.Y - V.Y, A.Z - V.Z,
        { A.M00, A.M01, A.M02, A.M10, A.M11, A.M12, A.M20, A.M21, A.M22 })
end

function CFrame:components()
    return self.X, self.Y, self.Z,
        self.M00, self.M01, self.M02,
        self.M10, self.M11, self.M12,
        self.M20, self.M21, self.M22
end
CFrame.GetComponents = CFrame.components

function CFrame:Inverse()
    local TM = {
        self.M00, self.M10, self.M20,
        self.M01, self.M11, self.M21,
        self.M02, self.M12, self.M22,
    }
    local IX = -(TM[1] * self.X + TM[2] * self.Y + TM[3] * self.Z)
    local IY = -(TM[4] * self.X + TM[5] * self.Y + TM[6] * self.Z)
    local IZ = -(TM[7] * self.X + TM[8] * self.Y + TM[9] * self.Z)
    return _NyxMakeCFrame(IX, IY, IZ, TM)
end
CFrame.inverse = CFrame.Inverse

function CFrame:ToWorldSpace(Other) return self * Other end
function CFrame:ToObjectSpace(Other) return self:Inverse() * Other end
function CFrame:PointToWorldSpace(V) return self * V end
function CFrame:PointToObjectSpace(V) return self:Inverse() * V end
function CFrame:VectorToWorldSpace(V)
    local X, Y, Z = _NyxMatVec(self, V.X, V.Y, V.Z)
    return Vector3.new(X, Y, Z)
end
function CFrame:VectorToObjectSpace(V) return self:Inverse():VectorToWorldSpace(V) end
function CFrame:ToEulerAnglesXYZ() return _NyxEulerXYZ(self) end
CFrame.ToOrientation = CFrame.ToEulerAnglesXYZ
function CFrame:ToEulerAnglesYXZ() return _NyxEulerXYZ(self) end
function CFrame:Lerp(Goal, Alpha)
    local PX = self.X + (Goal.X - self.X) * Alpha
    local PY = self.Y + (Goal.Y - self.Y) * Alpha
    local PZ = self.Z + (Goal.Z - self.Z) * Alpha
    local RX1, RY1, RZ1 = _NyxEulerXYZ(self)
    local RX2, RY2, RZ2 = _NyxEulerXYZ(Goal)
    local Rot = CFrame.Angles(
        RX1 + (RX2 - RX1) * Alpha,
        RY1 + (RY2 - RY1) * Alpha,
        RZ1 + (RZ2 - RZ1) * Alpha)
    return CFrame.new(PX, PY, PZ) * Rot
end

CFrame.identity = CFrame.new()

UDim = {}
UDim.__index = UDim
UDim.__add = function(A, B) return UDim.new(A.Scale + B.Scale, A.Offset + B.Offset) end
UDim.__sub = function(A, B) return UDim.new(A.Scale - B.Scale, A.Offset - B.Offset) end
UDim.__eq  = function(A, B) return A.Scale == B.Scale and A.Offset == B.Offset end
function UDim.new(S, O) return setmetatable({ Scale = S or 0, Offset = O or 0 }, UDim) end

UDim2 = {}
UDim2.__index = UDim2
UDim2.__add = function(A, B) return UDim2.new(A.X.Scale + B.X.Scale, A.X.Offset + B.X.Offset, A.Y.Scale + B.Y.Scale, A.Y.Offset + B.Y.Offset) end
UDim2.__sub = function(A, B) return UDim2.new(A.X.Scale - B.X.Scale, A.X.Offset - B.X.Offset, A.Y.Scale - B.Y.Scale, A.Y.Offset - B.Y.Offset) end
UDim2.__eq  = function(A, B) return A.X == B.X and A.Y == B.Y end
function UDim2.new(XS, XO, YS, YO)
    if _NyxIsType(XS, UDim) then
        return setmetatable({ X = XS, Y = XO, Width = XS, Height = XO }, UDim2)
    end
    local X, Y = UDim.new(XS, XO), UDim.new(YS, YO)
    return setmetatable({ X = X, Y = Y, Width = X, Height = Y }, UDim2)
end
function UDim2.fromScale(XS, YS) return UDim2.new(XS, 0, YS, 0) end
function UDim2.fromOffset(XO, YO) return UDim2.new(0, XO, 0, YO) end
function UDim2:Lerp(Goal, A)
    return UDim2.new(
        self.X.Scale + (Goal.X.Scale - self.X.Scale) * A,
        self.X.Offset + (Goal.X.Offset - self.X.Offset) * A,
        self.Y.Scale + (Goal.Y.Scale - self.Y.Scale) * A,
        self.Y.Offset + (Goal.Y.Offset - self.Y.Offset) * A)
end

Rect = {}
Rect.__index = Rect
function Rect.new(MinX, MinY, MaxX, MaxY)
    local Min, Max
    if _NyxIsType(MinX, Vector2) then
        Min, Max = MinX, MinY
    else
        Min, Max = Vector2.new(MinX, MinY), Vector2.new(MaxX, MaxY)
    end
    return setmetatable({
        Min = Min, Max = Max,
        Width = Max.X - Min.X, Height = Max.Y - Min.Y,
    }, Rect)
end

NumberRange = {}
NumberRange.__index = NumberRange
function NumberRange.new(Min, Max)
    return setmetatable({ Min = Min or 0, Max = Max or Min or 0 }, NumberRange)
end

NumberSequenceKeypoint = {}
NumberSequenceKeypoint.__index = NumberSequenceKeypoint
function NumberSequenceKeypoint.new(Time, Value, Envelope)
    return setmetatable({ Time = Time or 0, Value = Value or 0, Envelope = Envelope or 0 }, NumberSequenceKeypoint)
end

NumberSequence = {}
NumberSequence.__index = NumberSequence
function NumberSequence.new(A, B)
    local Keypoints
    if type(A) == "table" and not _NyxIsType(A, NumberSequenceKeypoint) then
        Keypoints = A
    elseif B ~= nil then
        Keypoints = { NumberSequenceKeypoint.new(0, A), NumberSequenceKeypoint.new(1, B) }
    else
        Keypoints = { NumberSequenceKeypoint.new(0, A or 0), NumberSequenceKeypoint.new(1, A or 0) }
    end
    return setmetatable({ Keypoints = Keypoints }, NumberSequence)
end

ColorSequenceKeypoint = {}
ColorSequenceKeypoint.__index = ColorSequenceKeypoint
function ColorSequenceKeypoint.new(Time, Value)
    return setmetatable({ Time = Time or 0, Value = Value or Color3.new() }, ColorSequenceKeypoint)
end

ColorSequence = {}
ColorSequence.__index = ColorSequence
function ColorSequence.new(A, B)
    local Keypoints
    if type(A) == "table" and not _NyxIsType(A, Color3) then
        Keypoints = A
    elseif B ~= nil then
        Keypoints = { ColorSequenceKeypoint.new(0, A), ColorSequenceKeypoint.new(1, B) }
    else
        Keypoints = { ColorSequenceKeypoint.new(0, A or Color3.new()), ColorSequenceKeypoint.new(1, A or Color3.new()) }
    end
    return setmetatable({ Keypoints = Keypoints }, ColorSequence)
end

Region3 = {}
Region3.__index = Region3
function Region3.new(Min, Max)
    Min = Min or Vector3.zero
    Max = Max or Vector3.zero
    local Center = (Min + Max) * 0.5
    local Size = Max - Min
    return setmetatable({ CFrame = CFrame.new(Center.X, Center.Y, Center.Z), Size = Size }, Region3)
end

Ray = {}
Ray.__index = Ray
function Ray.new(Origin, Direction)
    return setmetatable({
        Origin = Origin or Vector3.zero,
        Direction = Direction or Vector3.zero,
        Unit = nil,
    }, Ray)
end
function Ray:ClosestPoint(Point)
    local Dir = self.Direction.Unit
    local T = (Point - self.Origin):Dot(Dir)
    return self.Origin + Dir * math.max(T, 0)
end
function Ray:Distance(Point)
    return (Point - self:ClosestPoint(Point)).Magnitude
end

PhysicalProperties = {}
PhysicalProperties.__index = PhysicalProperties
function PhysicalProperties.new(Density, Friction, Elasticity, FrictionWeight, ElasticityWeight)
    return setmetatable({
        Density = Density or 0.7,
        Friction = Friction or 0.3,
        Elasticity = Elasticity or 0.5,
        FrictionWeight = FrictionWeight or 1,
        ElasticityWeight = ElasticityWeight or 1,
    }, PhysicalProperties)
end

local EnumItemMeta = {
    __tostring = function(E) return "Enum." .. E.EnumType .. "." .. E.Name end,
    __eq = function(A, B) return A.Name == B.Name and A.EnumType == B.EnumType end,
}

local function _NyxEnumName(V, Default)
    if type(V) == "table" and V._isEnumItem then return V.Name end
    if type(V) == "string" then return V end
    return Default
end

Enum = {}
local _EnumTypes = {}

local function MakeEnum(TypeName, Values)
    local E = { _enumType = TypeName }
    local Items = {}
    for I, Spec in ipairs(Values) do
        local Name, Value
        if type(Spec) == "table" then
            Name, Value = Spec[1], Spec[2]
        else
            Name, Value = Spec, I - 1
        end
        local Item = setmetatable(
            { Name = Name, Value = Value, EnumType = TypeName, _isEnumItem = true },
            EnumItemMeta)
        E[Name] = Item
        Items[#Items + 1] = Item
    end
    function E:GetEnumItems()
        local Copy = {}
        for I, V in ipairs(Items) do Copy[I] = V end
        return Copy
    end
    Enum[TypeName] = E
    _EnumTypes[TypeName] = E
    return E
end

MakeEnum("Material", {
    "Plastic", "SmoothPlastic", "Neon", "Wood", "WoodPlanks", "Marble", "Slate",
    "Concrete", "Granite", "Brick", "Pebble", "Cobblestone", "Rock", "Sandstone",
    "Basalt", "CrackedLava", "Limestone", "Pavement", "CorrodedMetal", "DiamondPlate",
    "Foil", "Metal", "Grass", "LeafyGrass", "Sand", "Fabric", "Snow", "Mud", "Ground",
    "Asphalt", "Salt", "Ice", "Glacier", "Glass", "ForceField", "Air", "Water", "Rubber",
})
MakeEnum("PartType", { "Ball", "Block", "Cylinder", "Wedge", "CornerWedge" })
MakeEnum("EasingStyle", {
    "Linear", "Sine", "Back", "Quad", "Quart", "Quint", "Bounce", "Elastic",
    "Exponential", "Circular", "Cubic",
})
MakeEnum("EasingDirection", { "In", "Out", "InOut" })
MakeEnum("PlaybackState", { "Begin", "Delayed", "Playing", "Paused", "Completed", "Cancelled" })
MakeEnum("CameraType", { "Fixed", "Attach", "Watch", "Track", "Follow", "Custom", "Scriptable", "Orbital" })
MakeEnum("RenderFidelity", { "Automatic", "Precise", "Performance" })
MakeEnum("CollisionFidelity", { "Default", "Hull", "Box", "PreciseConvexDecomposition" })
MakeEnum("NormalId", { "Right", "Top", "Back", "Left", "Bottom", "Front" })
MakeEnum("Axis", { "X", "Y", "Z" })
MakeEnum("FillDirection", { "Horizontal", "Vertical" })
MakeEnum("SortOrder", { "Name", "Custom", "LayoutOrder" })
MakeEnum("HorizontalAlignment", { "Center", "Left", "Right" })
MakeEnum("VerticalAlignment", { "Center", "Top", "Bottom" })
MakeEnum("KeyCode", {
    { "Unknown", 0 }, { "Space", 32 }, { "W", 119 }, { "A", 97 }, { "S", 115 }, { "D", 100 },
    { "Q", 113 }, { "E", 101 }, { "F", 102 }, { "R", 114 }, { "Return", 13 }, { "Escape", 27 },
    { "LeftShift", 304 }, { "LeftControl", 306 }, { "Up", 273 }, { "Down", 274 },
    { "Left", 276 }, { "Right", 275 },
})
MakeEnum("UserInputType", {
    "MouseButton1", "MouseButton2", "MouseButton3", "MouseWheel", "MouseMovement",
    "Touch", "Keyboard", "Focus", "Gamepad1", "TextInput", "None",
})
MakeEnum("UserInputState", { "Begin", "Change", "End", "Cancel", "None" })
MakeEnum("HumanoidStateType", {
    "FallingDown", "Running", "RunningNoPhysics", "Climbing", "StrafingNoPhysics",
    "Ragdoll", "GettingUp", "Jumping", "Landed", "Flying", "Freefall", "Seated",
    "PlatformStanding", "Dead", "Swimming", "Physics", "None",
})
MakeEnum("Font", { "Legacy", "Arial", "ArialBold", "SourceSans", "SourceSansBold", "Gotham", "GothamBold", "Code" })
MakeEnum("TextXAlignment", { "Left", "Right", "Center" })
MakeEnum("TextYAlignment", { "Top", "Center", "Bottom" })
MakeEnum("ZIndexBehavior", { "Global", "Sibling" })
MakeEnum("ScaleType", { "Stretch", "Slice", "Tile", "Fit", "Crop" })
MakeEnum("ActuatorType", { "None", "Motor", "Servo" })
MakeEnum("RaycastFilterType", { "Exclude", "Include", "Blacklist", "Whitelist" })

function Enum:GetEnums()
    local Out = {}
    for _, E in pairs(_EnumTypes) do Out[#Out + 1] = E end
    return Out
end

BrickColor = {}
BrickColor.__index    = BrickColor
BrickColor.__tostring = function(BC) return BC.Name or "BrickColor" end
BrickColor.__eq       = function(A, B) return A.Name == B.Name end

local _BrickColorPalette = {
    ["White"]                  = Color3.fromRGB(242, 243, 243),
    ["Institutional white"]    = Color3.fromRGB(248, 248, 248),
    ["Black"]                  = Color3.fromRGB(27,  42,  53),
    ["Really black"]           = Color3.fromRGB(17,  17,  17),
    ["Gray"]                   = Color3.fromRGB(163, 162, 165),
    ["Medium stone grey"]      = Color3.fromRGB(163, 162, 165),
    ["Dark stone grey"]        = Color3.fromRGB(99,  95,  98),
    ["Light stone grey"]       = Color3.fromRGB(243, 243, 243),
    ["Mid gray"]               = Color3.fromRGB(205, 205, 205),
    ["Bright red"]             = Color3.fromRGB(196, 40,  28),
    ["Really red"]             = Color3.fromRGB(255, 0,   0),
    ["Dark red"]               = Color3.fromRGB(123, 46,  47),
    ["Bright blue"]            = Color3.fromRGB(13,  105, 172),
    ["Really blue"]            = Color3.fromRGB(0,   0,   255),
    ["Navy blue"]              = Color3.fromRGB(0,   32,  96),
    ["Bright green"]           = Color3.fromRGB(75,  151, 75),
    ["Lime green"]             = Color3.fromRGB(0,   255, 0),
    ["Bright yellow"]          = Color3.fromRGB(245, 205, 48),
    ["New Yeller"]             = Color3.fromRGB(255, 255, 0),
    ["Bright orange"]          = Color3.fromRGB(218, 133, 65),
    ["Bright violet"]          = Color3.fromRGB(107, 50,  124),
    ["Brown"]                  = Color3.fromRGB(124, 92,  70),
    ["Reddish brown"]          = Color3.fromRGB(105, 64,  40),
    ["Gold"]                   = Color3.fromRGB(239, 184, 56),
    ["Cyan"]                   = Color3.fromRGB(4,   175, 236),
    ["Hot pink"]               = Color3.fromRGB(255, 0,   191),
}

function BrickColor.new(Arg, G, B)
    local Name, Color
    if type(Arg) == "number" and G ~= nil then
        Name, Color = "Custom", Color3.new(Arg, G, B)
    elseif type(Arg) == "string" then
        Name  = Arg
        Color = _BrickColorPalette[Arg] or Color3.fromRGB(163, 162, 165)
    elseif type(Arg) == "number" then
        Name, Color = tostring(Arg), Color3.fromRGB(163, 162, 165)
    elseif _NyxIsType(Arg, Color3) then
        Name, Color = "Custom", Arg
    else
        Name, Color = "Medium stone grey", Color3.fromRGB(163, 162, 165)
    end
    return setmetatable({
        Name = Name, Color = Color,
        r = Color.R, g = Color.G, b = Color.B, Number = 194,
    }, BrickColor)
end
function BrickColor.random()
    local Keys = {}
    for K in pairs(_BrickColorPalette) do Keys[#Keys + 1] = K end
    return BrickColor.new(Keys[math.random(#Keys)])
end
function BrickColor.Random() return BrickColor.random() end

local _NyxTypeByMeta = {
    [Vector3] = "Vector3", [Vector2] = "Vector2", [Color3] = "Color3",
    [CFrame] = "CFrame", [UDim] = "UDim", [UDim2] = "UDim2", [Rect] = "Rect",
    [NumberRange] = "NumberRange", [NumberSequence] = "NumberSequence",
    [ColorSequence] = "ColorSequence", [Region3] = "Region3", [Ray] = "Ray",
    [BrickColor] = "BrickColor", [PhysicalProperties] = "PhysicalProperties",
    [Signal] = "RBXScriptSignal",
}

function typeof(V)
    local T = type(V)
    if T ~= "table" then return T end
    local MT = getmetatable(V)
    if MT == EnumItemMeta then return "EnumItem" end
    if V._isInstance then return "Instance" end
    if MT and _NyxTypeByMeta[MT] then return _NyxTypeByMeta[MT] end
    return "table"
end

local function _NyxVec(V) return { X = (V and V.X) or 0, Y = (V and V.Y) or 0, Z = (V and V.Z) or 0 } end
local function _NyxColor(V) return { R = (V and V.R) or 0, G = (V and V.G) or 0, B = (V and V.B) or 0 } end
local function _NyxNonZeroVec(V)
    if not V then return false end
    return (V.X or 0) ~= 0 or (V.Y or 0) ~= 0 or (V.Z or 0) ~= 0
end
local function _NyxPush(Cmd) _NYX_COMMANDS[#_NYX_COMMANDS + 1] = Cmd end

local function _NyxShapeName(V)
    local Name = _NyxEnumName(V, "Block")
    if Name == "Ball" then return "Sphere" end
    return Name
end
local _ClassParent = {
    PVInstance = "Instance", Model = "PVInstance", WorldRoot = "Model",
    BasePart = "PVInstance", Part = "BasePart", MeshPart = "BasePart",
    WedgePart = "BasePart", CornerWedgePart = "BasePart", TrussPart = "BasePart",
    SpawnLocation = "Part", Seat = "Part", VehicleSeat = "BasePart",
    Terrain = "BasePart",
    Folder = "Instance", Configuration = "Instance", Camera = "Instance",
    Light = "Instance", PointLight = "Light", SpotLight = "Light", SurfaceLight = "Light",
    Sky = "Instance", Atmosphere = "Instance", Clouds = "Instance",
    Attachment = "Instance", Bone = "Attachment",
    JointInstance = "Instance", Weld = "JointInstance", Motor6D = "JointInstance",
    WeldConstraint = "Instance", Constraint = "Instance",
    HingeConstraint = "Constraint", SpringConstraint = "Constraint",
    Humanoid = "Instance", Accessory = "Instance", Tool = "Instance",
    Sound = "Instance", SoundGroup = "Instance",
    ParticleEmitter = "Instance", Beam = "Instance", Trail = "Instance",
    Fire = "Instance", Smoke = "Instance", Sparkles = "Instance",
    Decal = "Instance", Texture = "Decal",
    ValueBase = "Instance",
    IntValue = "ValueBase", NumberValue = "ValueBase", StringValue = "ValueBase",
    BoolValue = "ValueBase", ObjectValue = "ValueBase", Vector3Value = "ValueBase",
    CFrameValue = "ValueBase", Color3Value = "ValueBase", BrickColorValue = "ValueBase",
    RayValue = "ValueBase",
    LuaSourceContainer = "Instance", BaseScript = "LuaSourceContainer",
    Script = "BaseScript", LocalScript = "Script", ModuleScript = "LuaSourceContainer",
    GuiBase = "Instance", GuiBase2d = "GuiBase", LayerCollector = "GuiBase2d",
    ScreenGui = "LayerCollector", SurfaceGui = "LayerCollector", BillboardGui = "LayerCollector",
    GuiObject = "GuiBase2d", Frame = "GuiObject", TextLabel = "GuiObject",
    TextButton = "GuiObject", TextBox = "GuiObject", ImageLabel = "GuiObject",
    ImageButton = "GuiObject", ScrollingFrame = "Frame",
    UIBase = "Instance", UIComponent = "UIBase", UIConstraint = "UIComponent",
    UILayout = "UIComponent", UIListLayout = "UILayout", UIGridLayout = "UILayout",
    UIPadding = "UIComponent", UICorner = "UIComponent", UIAspectRatioConstraint = "UIConstraint",
    ProximityPrompt = "Instance", ClickDetector = "Instance",
    Highlight = "Instance", SelectionBox = "Instance",
}

local function _NyxIsAClass(ClassName, Target)
    if Target == "Instance" then return true end
    local C = ClassName
    while C do
        if C == Target then return true end
        C = _ClassParent[C]
    end
    return false
end

local _ClassDefaults = {}
local function _ClassDefaultsFor(ClassName)
    local D = {}
    if _NyxIsAClass(ClassName, "BasePart") then
        D.Color = Color3.fromRGB(163, 162, 165)
        D.Size = Vector3.new(4, 1.2, 2)
        D.Position = Vector3.new(0, 0.6, 0)
        D.Orientation = Vector3.new(0, 0, 0)
        D.Anchored = false
        D.CanCollide = true
        D.CanTouch = true
        D.CanQuery = true
        D.Transparency = 0
        D.Reflectance = 0
        D.Material = "SmoothPlastic"
        D.Shape = "Block"
        D.CastShadow = true
        D.Massless = false
        D.RootPriority = 0
        D.CollisionGroup = "Default"
        D.AssemblyLinearVelocity = Vector3.zero
        D.AssemblyAngularVelocity = Vector3.zero
        D.Velocity = Vector3.zero
        D.RotVelocity = Vector3.zero
    end
    if _NyxIsAClass(ClassName, "Light") then
        D.Color = Color3.new(1, 1, 1)
        D.Brightness = 1
        D.Range = 16
        D.Enabled = true
        D.Shadows = false
    end
    if ClassName == "Humanoid" then
        D.Health = 100; D.MaxHealth = 100; D.WalkSpeed = 16; D.JumpPower = 50
        D.JumpHeight = 7.2; D.HipHeight = 0; D.MoveDirection = Vector3.zero
    end
    if _NyxIsAClass(ClassName, "ValueBase") then
        if ClassName == "IntValue" or ClassName == "NumberValue" then D.Value = 0
        elseif ClassName == "StringValue" then D.Value = ""
        elseif ClassName == "BoolValue" then D.Value = false
        elseif ClassName == "Vector3Value" then D.Value = Vector3.zero
        elseif ClassName == "Color3Value" then D.Value = Color3.new()
        elseif ClassName == "CFrameValue" then D.Value = CFrame.new()
        else D.Value = nil end
    end
    if ClassName == "Sound" then
        D.SoundId = ""; D.Volume = 0.5; D.Playing = false; D.Looped = false
        D.PlaybackSpeed = 1; D.TimePosition = 0; D.IsPlaying = false
    end
    return D
end

local _NyxPartId = 0
local _NyxRegisterSubtree
local _NyxApplyPartProperty
local _NyxRegisterPart
local _NyxRegisterLight
local _NyxRegisterSky
local _WorkspaceInstance

local _NyxInstanceMethods = {}

local function _NyxNewInstance(ClassName)
    local D = {
        _className = ClassName,
        Name = ClassName,
        _children = {},
        _parent = nil,
        _attributes = {},
        _tags = {},
        _signals = nil,
        _renderKind = nil,
        _NyxReg = false,
        Archivable = true,
    }
    for K, V in pairs(_ClassDefaultsFor(ClassName)) do D[K] = V end

    if _NyxIsAClass(ClassName, "BasePart") then
        D._renderKind = "Part"
        _NyxPartId = _NyxPartId + 1
        D._id = "Part_" .. _NyxPartId
        D._physicsTouched = {}
    elseif _NyxIsAClass(ClassName, "Light") then
        D._renderKind = "Light"
    elseif ClassName == "Sky" then
        D._renderKind = "Sky"
        D.SkyColor = Color3.fromRGB(100, 148, 237)
    end

    local Proxy
    local function GetSignal(Name)
        D._signals = D._signals or {}
        if not D._signals[Name] then D._signals[Name] = _NyxNewSignal() end
        return D._signals[Name]
    end
    D._getSignal = GetSignal

    local MT = {
        __index = function(_, K)
            local M = _NyxInstanceMethods[K]
            if M ~= nil then return M end
            if K == "Parent" then return D._parent end
            if K == "ClassName" then return D._className end
            if K == "Changed" or K == "ChildAdded" or K == "ChildRemoved"
                or K == "DescendantAdded" or K == "DescendantRemoving"
                or K == "AncestryChanged" or K == "Destroying" then
                return GetSignal(K)
            end
            local Val = rawget(D, K)
            if Val ~= nil then return Val end
            for _, Child in ipairs(D._children) do
                if rawget(getmetatable(Child).__data, "Name") == K then return Child end
            end
            return nil
        end,
        __newindex = function(_, K, V)
            if K == "Parent" then
                _NyxInstanceMethods.__setparent(Proxy, D, V)
                return
            end
            if K == "BrickColor" and _NyxIsType(V, BrickColor) then
                rawset(D, "Color", V.Color)
            end
            local Old = rawget(D, K)
            rawset(D, K, V)
            if D._renderKind == "Part" then
                if K == "CFrame" and getmetatable(V) == CFrame then
                    rawset(D, "Position", Vector3.new(V.X or 0, V.Y or 0, V.Z or 0))
                elseif K == "Position" and type(V) == "table" then
                    local CF = rawget(D, "CFrame")
                    if getmetatable(CF) == CFrame then
                        CF.X = V.X or 0
                        CF.Y = V.Y or 0
                        CF.Z = V.Z or 0
                    end
                end
                if _NyxIsAClass(D._className, "BasePart")
                    and (K == "AssemblyLinearVelocity" or K == "Velocity"
                        or K == "AssemblyAngularVelocity" or K == "RotVelocity"
                        or K == "Force" or K == "Impulse" or K == "Massless"
                        or K == "Mass" or K == "Density") then
                    D._physicsTouched = D._physicsTouched or {}
                    D._physicsTouched[K] = true
                end
                if D._NyxReg then _NyxApplyPartProperty(D, K, V) end
            elseif D._renderKind == "Lighting" then
                if (K == "Ambient" or K == "OutdoorAmbient") and _NyxIsType(V, Color3) then
                    _NyxPush({ Cmd = "SetSkybox", Color = _NyxColor(V) })
                end
            elseif D._renderKind == "Camera" then
                if K == "CFrame" and _NyxIsType(V, CFrame) then
                    _NyxInstanceMethods.__emitcamera(V)
                end
            elseif D._renderKind == "Workspace" then
                if K == "Gravity" then
                    _NyxPush({ Cmd = "SetGravity", Value = V or 196.2 })
                end
            elseif D._renderKind == "Sky" then
                if K == "SkyColor" and D._NyxReg and _NyxIsType(V, Color3) then
                    _NyxPush({ Cmd = "SetSkybox", Color = _NyxColor(V) })
                end
            end
            if Old ~= V and D._signals then
                local CS = D._signals["Changed"]
                if CS then CS:Fire(K) end
                local PS = D._signals["__prop_" .. K]
                if PS then PS:Fire() end
            end
        end,
        __tostring = function() return rawget(D, "Name") or D._className end,
        __data = D,
    }
    D._isInstance = true
    Proxy = setmetatable({}, MT)
    D._proxy = Proxy
    return Proxy
end
local function _Data(Self) return getmetatable(Self).__data end

function _NyxInstanceMethods.GetChildren(Self)
    local D = _Data(Self)
    local Out = {}
    for I, C in ipairs(D._children) do Out[I] = C end
    return Out
end
_NyxInstanceMethods.getChildren = _NyxInstanceMethods.GetChildren

function _NyxInstanceMethods.GetDescendants(Self)
    local Out = {}
    local function Walk(D)
        for _, C in ipairs(D._children) do
            Out[#Out + 1] = C
            Walk(_Data(C))
        end
    end
    Walk(_Data(Self))
    return Out
end

function _NyxInstanceMethods.FindFirstChild(Self, Name, Recursive)
    local D = _Data(Self)
    for _, C in ipairs(D._children) do
        if rawget(_Data(C), "Name") == Name then return C end
    end
    if Recursive then
        for _, C in ipairs(D._children) do
            local Found = _NyxInstanceMethods.FindFirstChild(C, Name, true)
            if Found then return Found end
        end
    end
    return nil
end
_NyxInstanceMethods.findFirstChild = _NyxInstanceMethods.FindFirstChild

function _NyxInstanceMethods.FindFirstChildOfClass(Self, ClassName)
    for _, C in ipairs(_Data(Self)._children) do
        if _Data(C)._className == ClassName then return C end
    end
    return nil
end

function _NyxInstanceMethods.FindFirstChildWhichIsA(Self, ClassName, Recursive)
    for _, C in ipairs(_Data(Self)._children) do
        if _NyxIsAClass(_Data(C)._className, ClassName) then return C end
    end
    if Recursive then
        for _, C in ipairs(_Data(Self)._children) do
            local Found = _NyxInstanceMethods.FindFirstChildWhichIsA(C, ClassName, true)
            if Found then return Found end
        end
    end
    return nil
end

function _NyxInstanceMethods.WaitForChild(Self, Name, _Timeout)
    return _NyxInstanceMethods.FindFirstChild(Self, Name)
end
_NyxInstanceMethods.waitForChild = _NyxInstanceMethods.WaitForChild

function _NyxInstanceMethods.FindFirstAncestor(Self, Name)
    local P = _Data(Self)._parent
    while P do
        if rawget(_Data(P), "Name") == Name then return P end
        P = _Data(P)._parent
    end
    return nil
end

function _NyxInstanceMethods.FindFirstAncestorOfClass(Self, ClassName)
    local P = _Data(Self)._parent
    while P do
        if _Data(P)._className == ClassName then return P end
        P = _Data(P)._parent
    end
    return nil
end

function _NyxInstanceMethods.FindFirstAncestorWhichIsA(Self, ClassName)
    local P = _Data(Self)._parent
    while P do
        if _NyxIsAClass(_Data(P)._className, ClassName) then return P end
        P = _Data(P)._parent
    end
    return nil
end

function _NyxInstanceMethods.IsA(Self, ClassName)
    return _NyxIsAClass(_Data(Self)._className, ClassName)
end
_NyxInstanceMethods.isA = _NyxInstanceMethods.IsA

function _NyxInstanceMethods.IsDescendantOf(Self, Other)
    local P = _Data(Self)._parent
    while P do
        if P == Other then return true end
        P = _Data(P)._parent
    end
    return false
end

function _NyxInstanceMethods.IsAncestorOf(Self, Other)
    return _NyxInstanceMethods.IsDescendantOf(Other, Self)
end

function _NyxInstanceMethods.GetFullName(Self)
    local Parts = {}
    local Cur = Self
    while Cur do
        local D = _Data(Cur)
        table.insert(Parts, 1, rawget(D, "Name"))
        Cur = D._parent
        if Cur and _Data(Cur)._renderKind == "DataModel" then break end
    end
    return table.concat(Parts, ".")
end

function _NyxInstanceMethods.GetActor(_Self) return nil end
function _NyxInstanceMethods.GetDebugId(Self) return tostring(_Data(Self)._id or _Data(Self).Name) end

function _NyxInstanceMethods.ClearAllChildren(Self)
    local D = _Data(Self)
    for _, C in ipairs({ table.unpack(D._children) }) do
        _NyxInstanceMethods.Destroy(C)
    end
end

function _NyxInstanceMethods.Destroy(Self)
    local D = _Data(Self)
    if D._signals and D._signals["Destroying"] then D._signals["Destroying"]:Fire() end
    _NyxInstanceMethods.__setparent(Self, D, nil)
    for _, C in ipairs({ table.unpack(D._children) }) do
        _NyxInstanceMethods.Destroy(C)
    end
    D._destroyed = true
end
_NyxInstanceMethods.destroy = _NyxInstanceMethods.Destroy
function _NyxInstanceMethods.Remove(Self) _NyxInstanceMethods.Destroy(Self) end

function _NyxInstanceMethods.Clone(Self)
    local D = _Data(Self)
    local Copy = _NyxNewInstance(D._className)
    local CD = _Data(Copy)
    for K, V in pairs(D) do
        if type(K) == "string" and K:sub(1, 1) ~= "_"
            and K ~= "Parent" and K ~= "ClassName" then
            rawset(CD, K, V)
        end
    end
    for K, V in pairs(D._attributes) do CD._attributes[K] = V end
    for _, Child in ipairs(D._children) do
        local ChildClone = _NyxInstanceMethods.Clone(Child)
        _NyxInstanceMethods.__setparent(ChildClone, _Data(ChildClone), Copy)
    end
    return Copy
end
_NyxInstanceMethods.clone = _NyxInstanceMethods.Clone

function _NyxInstanceMethods.GetAttribute(Self, Name) return _Data(Self)._attributes[Name] end
function _NyxInstanceMethods.SetAttribute(Self, Name, Value)
    local D = _Data(Self)
    D._attributes[Name] = Value
    if D._getSignal then
        local S = D._signals and D._signals["__attr_" .. Name]
        if S then S:Fire() end
    end
end
function _NyxInstanceMethods.GetAttributes(Self)
    local Out = {}
    for K, V in pairs(_Data(Self)._attributes) do Out[K] = V end
    return Out
end
function _NyxInstanceMethods.GetAttributeChangedSignal(Self, Name)
    return _Data(Self)._getSignal("__attr_" .. Name)
end
function _NyxInstanceMethods.GetPropertyChangedSignal(Self, Name)
    return _Data(Self)._getSignal("__prop_" .. Name)
end

function _NyxInstanceMethods.GetTags(Self)
    local Out = {}
    for T in pairs(_Data(Self)._tags) do Out[#Out + 1] = T end
    return Out
end
function _NyxInstanceMethods.HasTag(Self, Tag) return _Data(Self)._tags[Tag] == true end
function _NyxInstanceMethods.AddTag(Self, Tag) _Data(Self)._tags[Tag] = true end
function _NyxInstanceMethods.RemoveTag(Self, Tag) _Data(Self)._tags[Tag] = nil end

function _NyxInstanceMethods.GetService(Self, Name) return _NyxGetService(Name) end

function _NyxInstanceMethods.__setparent(Self, D, NewParent)
    local Old = D._parent
    if Old == NewParent then return end
    if Old then
        local OC = _Data(Old)._children
        for I, C in ipairs(OC) do
            if C == Self then table.remove(OC, I); break end
        end
        local OD = _Data(Old)
        if OD._signals and OD._signals["ChildRemoved"] then
            OD._signals["ChildRemoved"]:Fire(Self)
        end
    end
    D._parent = NewParent
    if NewParent then
        local NC = _Data(NewParent)._children
        NC[#NC + 1] = Self
        local ND = _Data(NewParent)
        if ND._signals and ND._signals["ChildAdded"] then
            ND._signals["ChildAdded"]:Fire(Self)
        end
        local Anc = NewParent
        while Anc do
            local AD = _Data(Anc)
            if AD._signals and AD._signals["DescendantAdded"] then
                AD._signals["DescendantAdded"]:Fire(Self)
            end
            Anc = AD._parent
        end
    end
    if D._signals and D._signals["AncestryChanged"] then
        D._signals["AncestryChanged"]:Fire(Self, NewParent)
    end
    if NewParent then
        if _NyxInWorkspace(Self) then _NyxRegisterSubtree(Self) end
        if D._renderKind == "Light" and not D._NyxReg then _NyxRegisterLight(D) end
        if D._renderKind == "Sky" and not D._NyxReg then _NyxRegisterSky(D) end
    end
end

function _NyxInstanceMethods.__emitcamera(CF)
    local Eye = CF._eye or Vector3.new(CF.X, CF.Y, CF.Z)
    local Target = CF._target
    if not Target then
        local LV = CF.LookVector
        Target = Vector3.new(CF.X + LV.X, CF.Y + LV.Y, CF.Z + LV.Z)
    end
    _NyxPush({
        Cmd = "SetCamera",
        Position = { X = Eye.X, Y = Eye.Y, Z = Eye.Z },
        LookAt = { X = Target.X, Y = Target.Y, Z = Target.Z },
    })
end

function _NyxInWorkspace(Self)
    local P = _Data(Self)._parent
    while P do
        if P == _WorkspaceInstance then return true end
        P = _Data(P)._parent
    end
    return false
end

_NyxRegisterSubtree = function(Self)
    local D = _Data(Self)
    if D._renderKind == "Part" and not D._NyxReg then
        _NyxRegisterPart(D)
    end
    for _, C in ipairs(D._children) do _NyxRegisterSubtree(C) end
end

local function _NyxTouchesPhysics(K)
    return K == "AssemblyLinearVelocity" or K == "Velocity"
        or K == "AssemblyAngularVelocity" or K == "RotVelocity"
        or K == "Force" or K == "Impulse"
        or K == "Massless" or K == "Mass" or K == "Density"
end

_NyxApplyPartProperty = function(D, K, V)
    local C = D._NyxCommand
    if not C then return end
    if K == "Position" then
        C.Position = _NyxVec(V); C.CFrame.X = V.X or 0; C.CFrame.Y = V.Y or 0; C.CFrame.Z = V.Z or 0
    elseif K == "Size" then C.Size = _NyxVec(V)
    elseif K == "Color" then C.Color = _NyxColor(V)
    elseif K == "BrickColor" then
        local Col = _NyxIsType(V, BrickColor) and V.Color
        if Col then C.Color = _NyxColor(Col) end
    elseif K == "CFrame" then
        C.CFrame = { X = V.X or 0, Y = V.Y or 0, Z = V.Z or 0, RX = V.RX or 0, RY = V.RY or 0, RZ = V.RZ or 0 }
        C.Position = { X = V.X or 0, Y = V.Y or 0, Z = V.Z or 0 }
    elseif K == "AssemblyLinearVelocity" or K == "Velocity" then
        C.AssemblyLinearVelocity = _NyxVec(V); C.Velocity = _NyxVec(V)
    elseif K == "AssemblyAngularVelocity" or K == "RotVelocity" then
        C.AssemblyAngularVelocity = _NyxVec(V); C.RotVelocity = _NyxVec(V)
    elseif K == "Force" then C.Force = _NyxVec(V)
    elseif K == "Impulse" then C.Impulse = _NyxVec(V)
    elseif K == "Transparency" then C.Transparency = V or 0
    elseif K == "Material" then C.Material = _NyxEnumName(V, "SmoothPlastic")
    elseif K == "Shape" then C.Shape = _NyxShapeName(V)
    elseif K == "Anchored" then C.Anchored = V and true or false
    elseif K == "CanCollide" then C.CanCollide = V and true or false
    elseif K == "Massless" then C.Massless = V and true or false
    elseif K == "Mass" then C.Mass = V or 1
    elseif K == "Density" then C.Density = V or 1
    elseif K == "Name" then C.Name = tostring(V or "Part")
    end
end

_NyxRegisterPart = function(D)
    if D._NyxReg then return end
    local Pos = D.Position or Vector3.new(0, 0, 0)
    local Siz = D.Size or Vector3.new(4, 1.2, 2)
    local Col = D.Color or Color3.fromRGB(163, 162, 165)
    local CF = D.CFrame
    local Lin = D.AssemblyLinearVelocity or D.Velocity or Vector3.zero
    local Ang = D.AssemblyAngularVelocity or D.RotVelocity or Vector3.zero
    local Force = D.Force or Vector3.zero
    local Impulse = D.Impulse or Vector3.zero
    local Touched = D._physicsTouched or {}

    local Command = {
        Cmd = "AddPart",
        Id = D._id,
        Name = D.Name or D._id,
        Position = _NyxVec(Pos),
        Size = _NyxVec(Siz),
        Color = _NyxColor(Col),
        CFrame = {
            X = (CF and CF.X) or Pos.X, Y = (CF and CF.Y) or Pos.Y, Z = (CF and CF.Z) or Pos.Z,
            RX = (CF and CF.RX) or 0, RY = (CF and CF.RY) or 0, RZ = (CF and CF.RZ) or 0,
        },
        Anchored = D.Anchored and true or false,
        CanCollide = D.CanCollide and true or false,
        Transparency = D.Transparency or 0,
        Material = _NyxEnumName(D.Material, "SmoothPlastic"),
        Shape = _NyxShapeName(D.Shape),
    }
    if Touched.AssemblyLinearVelocity or Touched.Velocity or _NyxNonZeroVec(Lin) then
        Command.AssemblyLinearVelocity = _NyxVec(Lin)
        Command.Velocity = _NyxVec(Lin)
    end
    if Touched.AssemblyAngularVelocity or Touched.RotVelocity or _NyxNonZeroVec(Ang) then
        Command.AssemblyAngularVelocity = _NyxVec(Ang)
        Command.RotVelocity = _NyxVec(Ang)
    end
    if Touched.Force or _NyxNonZeroVec(Force) then Command.Force = _NyxVec(Force) end
    if Touched.Impulse or _NyxNonZeroVec(Impulse) then Command.Impulse = _NyxVec(Impulse) end
    if Touched.Massless or D.Massless then Command.Massless = D.Massless and true or false end
    if Touched.Mass and D.Mass ~= nil then Command.Mass = D.Mass end
    if Touched.Density and D.Density ~= nil then Command.Density = D.Density end

    if D._attributes and D._attributes["NyxUserOwnable"] then
        Command.UserOwnable = true
    end

    _NyxPush(Command)
    D._NyxCommand = Command
    D._NyxReg = true
end

_NyxRegisterLight = function(D)
    if D._NyxReg then return end
    D._NyxReg = true
    local Pos = D.Position or Vector3.new(5, 10, 5)
    local Col = D.Color or Color3.new(1, 1, 1)
    local LightType = (D._className == "DirectionalLight") and "Directional" or "Point"
    _NyxPush({
        Cmd = "AddLight",
        LightType = LightType,
        Position = _NyxVec(Pos),
        Color = _NyxColor(Col),
        Intensity = D.Brightness or 1.0,
    })
end

_NyxRegisterSky = function(D)
    if D._NyxReg then return end
    D._NyxReg = true
    local Col = D.SkyColor or Color3.fromRGB(100, 148, 237)
    _NyxPush({ Cmd = "SetSkybox", Color = _NyxColor(Col) })
end

_ClassParent.DirectionalLight = "Light"

function _NyxInstanceMethods.GetMass(Self)
    local D = _Data(Self)
    if D.Mass then return D.Mass end
    local S = D.Size or Vector3.new(4, 1.2, 2)
    local Density = D.Density or 0.7
    return math.max((S.X or 1) * (S.Y or 1) * (S.Z or 1) * Density, 0.001)
end

function _NyxInstanceMethods.ApplyImpulse(Self, Impulse)
    local D = _Data(Self)
    Impulse = Impulse or Vector3.zero
    local Mass = _NyxInstanceMethods.GetMass(Self)
    local NewVel = (D.AssemblyLinearVelocity or D.Velocity or Vector3.zero) + (Impulse * (1 / Mass))
    rawset(D, "AssemblyLinearVelocity", NewVel)
    rawset(D, "Velocity", NewVel)
    rawset(D, "Impulse", (D.Impulse or Vector3.zero) + Impulse)
    D._physicsTouched = D._physicsTouched or {}
    D._physicsTouched.AssemblyLinearVelocity = true
    D._physicsTouched.Impulse = true
    if D._NyxReg then
        _NyxApplyPartProperty(D, "AssemblyLinearVelocity", NewVel)
        _NyxApplyPartProperty(D, "Impulse", D.Impulse)
    end
end

function _NyxInstanceMethods.ApplyForce(Self, Force)
    local D = _Data(Self)
    rawset(D, "Force", (D.Force or Vector3.zero) + (Force or Vector3.zero))
    D._physicsTouched = D._physicsTouched or {}
    D._physicsTouched.Force = true
    if D._NyxReg then _NyxApplyPartProperty(D, "Force", D.Force) end
end

function _NyxInstanceMethods.ApplyAngularImpulse(_Self, _Impulse) end
function _NyxInstanceMethods.SetNetworkOwner(_Self, _Player) end
function _NyxInstanceMethods.GetNetworkOwner(_Self) return nil end
function _NyxInstanceMethods.GetVelocityAtPosition(_Self, _Pos) return Vector3.zero end
function _NyxInstanceMethods.GetMaterial(Self) return _Data(Self).Material end
function _NyxInstanceMethods.CanSetNetworkOwnership(_Self) return true end

function _NyxInstanceMethods.GetConnectedParts(_Self, _Recursive) return {} end
function _NyxInstanceMethods.GetJoints(_Self) return {} end
function _NyxInstanceMethods.GetTouchingParts(_Self) return {} end
function _NyxInstanceMethods.GetRootPart(Self) return Self end
function _NyxInstanceMethods.BreakJoints(_Self) end
function _NyxInstanceMethods.MakeJoints(_Self) end

function _NyxInstanceMethods.GetPrimaryPartCFrame(Self)
    local D = _Data(Self)
    return (D.PrimaryPart and _Data(D.PrimaryPart).CFrame) or CFrame.new()
end
function _NyxInstanceMethods.SetPrimaryPartCFrame(_Self, _CF) end
function _NyxInstanceMethods.MoveTo(_Self, _Pos) end
function _NyxInstanceMethods.PivotTo(_Self, _CF) end
function _NyxInstanceMethods.GetPivot(Self)
    local D = _Data(Self)
    return (D.PrimaryPart and _Data(D.PrimaryPart).CFrame) or CFrame.new()
end
function _NyxInstanceMethods.GetBoundingBox(_Self) return CFrame.new(), Vector3.new(4, 4, 4) end
function _NyxInstanceMethods.GetExtentsSize(_Self) return Vector3.new(4, 4, 4) end
function _NyxInstanceMethods.GetModelCFrame(_Self) return CFrame.new() end
function _NyxInstanceMethods.TranslateBy(_Self, _V) end

function _NyxInstanceMethods.Play(Self) rawset(_Data(Self), "Playing", true) end
function _NyxInstanceMethods.Stop(Self) rawset(_Data(Self), "Playing", false) end
function _NyxInstanceMethods.Pause(Self) rawset(_Data(Self), "Playing", false) end
function _NyxInstanceMethods.Resume(Self) rawset(_Data(Self), "Playing", true) end

function _NyxInstanceMethods.TakeDamage(Self, Amount)
    local D = _Data(Self)
    rawset(D, "Health", math.max((D.Health or 0) - (Amount or 0), 0))
end
function _NyxInstanceMethods.MoveTo2(_Self) end
function _NyxInstanceMethods.LoadAnimation(_Self) return _NyxNewInstance("AnimationTrack") end
function _NyxInstanceMethods.GetState(_Self) return Enum.HumanoidStateType.Running end
function _NyxInstanceMethods.ChangeState(_Self, _State) end

local _KnownClasses = {}
for K in pairs(_ClassParent) do _KnownClasses[K] = true end
Instance = {}
for _, Extra in ipairs({
    "Instance", "DirectionalLight", "AnimationTrack", "Animation", "Animator",
    "BodyVelocity", "BodyPosition", "BodyGyro", "BodyForce", "AlignPosition",
    "AlignOrientation", "VectorForce", "LinearVelocity", "AngularVelocity",
    "ProximityPromptService", "BindableEvent", "BindableFunction",
    "RemoteEvent", "RemoteFunction", "Part",
}) do _KnownClasses[Extra] = true end

function Instance.new(ClassName, Parent)
    local Inst = _NyxNewInstance(ClassName)
    if Parent ~= nil then
        _NyxInstanceMethods.__setparent(Inst, _Data(Inst), Parent)
    end
    return Inst
end

function Instance.fromExisting(Existing) return _NyxInstanceMethods.Clone(Existing) end

local _Services = {}

local function _NyxMakeServiceInstance(ClassName, RenderKind)
    local Svc = _NyxNewInstance(ClassName)
    local D = _Data(Svc)
    D._renderKind = RenderKind or D._renderKind
    return Svc
end

_WorkspaceInstance = _NyxMakeServiceInstance("Workspace", "Workspace")
do
    local WD = _Data(_WorkspaceInstance)
    rawset(WD, "Name", "Workspace")
    rawset(WD, "Gravity", 196.2)
    rawset(WD, "FallenPartsDestroyHeight", -500)
end
workspace = _WorkspaceInstance
_ClassParent.Workspace = "WorldRoot"

function _NyxInstanceMethods.SetGravity(Self, N)
    rawset(_Data(Self), "Gravity", N or 196.2)
    _NyxPush({ Cmd = "SetGravity", Value = N or 196.2 })
end
function _NyxInstanceMethods.SetSkybox(_Self, Color)
    _NyxPush({ Cmd = "SetSkybox", Color = _NyxColor(Color or Color3.fromRGB(100, 148, 237)) })
end
function _NyxInstanceMethods.AddPart(Self, P)
    if not P then return end
    _NyxInstanceMethods.__setparent(P, _Data(P), Self)
end
function _NyxInstanceMethods.AddParts(Self, ...)
    for _, P in ipairs({ ... }) do _NyxInstanceMethods.AddPart(Self, P) end
end
function _NyxInstanceMethods.Raycast(_Self, _Origin, _Dir, _Params) return nil end
function _NyxInstanceMethods.Blockcast(_Self) return nil end
function _NyxInstanceMethods.GetPartBoundsInBox(_Self) return {} end
function _NyxInstanceMethods.GetPartsInPart(_Self) return {} end

local _CameraInstance = _NyxMakeServiceInstance("Camera", "Camera")
do
    local CD = _Data(_CameraInstance)
    rawset(CD, "Name", "Camera")
    rawset(CD, "CameraType", Enum.CameraType.Custom)
    rawset(CD, "FieldOfView", 70)
    rawset(CD, "CFrame", CFrame.new())
    rawset(_Data(_WorkspaceInstance), "CurrentCamera", _CameraInstance)
end
Camera = _CameraInstance
function _NyxInstanceMethods.SetPosition(_Self, Eye, LookAt)
    Eye = Eye or Vector3.new(10, 10, 10)
    LookAt = LookAt or Vector3.zero
    _NyxPush({
        Cmd = "SetCamera",
        Position = _NyxVec(Eye),
        LookAt = _NyxVec(LookAt),
    })
end
function _NyxInstanceMethods.GetRenderCFrame(Self) return _Data(Self).CFrame or CFrame.new() end
function _NyxInstanceMethods.ScreenPointToRay(_Self) return Ray.new() end
function _NyxInstanceMethods.ViewportPointToRay(_Self) return Ray.new() end
function _NyxInstanceMethods.WorldToScreenPoint(_Self) return Vector3.zero, false end
function _NyxInstanceMethods.WorldToViewportPoint(_Self) return Vector3.zero, false end

local _LightingInstance = _NyxMakeServiceInstance("Lighting", "Lighting")
do
    local LD = _Data(_LightingInstance)
    rawset(LD, "Name", "Lighting")
    rawset(LD, "Ambient", Color3.fromRGB(0, 0, 0))
    rawset(LD, "OutdoorAmbient", Color3.fromRGB(70, 70, 70))
    rawset(LD, "Brightness", 2)
    rawset(LD, "ClockTime", 14)
    rawset(LD, "GeographicLatitude", 0)
    rawset(LD, "FogColor", Color3.fromRGB(192, 192, 192))
    rawset(LD, "FogEnd", 100000)
    rawset(LD, "FogStart", 0)
    rawset(LD, "GlobalShadows", true)
end
Lighting = _LightingInstance
function _NyxInstanceMethods.AddDirectionalLight(_Self, Spec)
    Spec = Spec or {}
    _NyxPush({
        Cmd = "AddLight",
        LightType = "Directional",
        Position = _NyxVec(Spec.Position or Vector3.new(5, 10, 5)),
        Color = _NyxColor(Spec.Color or Color3.new(1, 1, 1)),
        Intensity = Spec.Intensity or Spec.Brightness or 1.0,
    })
end
function _NyxInstanceMethods.AddPointLight(_Self, Spec)
    Spec = Spec or {}
    _NyxPush({
        Cmd = "AddLight",
        LightType = "Point",
        Position = _NyxVec(Spec.Position or Vector3.new(0, 5, 0)),
        Color = _NyxColor(Spec.Color or Color3.new(1, 1, 1)),
        Intensity = Spec.Intensity or Spec.Brightness or 3.0,
    })
end
function _NyxInstanceMethods.GetMinutesAfterMidnight(Self) return (_Data(Self).ClockTime or 14) * 60 end
function _NyxInstanceMethods.SetMinutesAfterMidnight(Self, M) rawset(_Data(Self), "ClockTime", (M or 0) / 60) end
function _NyxInstanceMethods.GetSunDirection(_Self) return Vector3.new(0, 1, 0) end
function _NyxInstanceMethods.GetMoonDirection(_Self) return Vector3.new(0, -1, 0) end

TweenInfo = {}
TweenInfo.__index = TweenInfo
function TweenInfo.new(Time, EasingStyle, EasingDirection, RepeatCount, Reverses, DelayTime)
    return setmetatable({
        Time = Time or 1,
        EasingStyle = EasingStyle or Enum.EasingStyle.Quad,
        EasingDirection = EasingDirection or Enum.EasingDirection.Out,
        RepeatCount = RepeatCount or 0,
        Reverses = Reverses and true or false,
        DelayTime = DelayTime or 0,
    }, TweenInfo)
end

local function _NyxBounceOut(Alpha)
    local N1, D1 = 7.5625, 2.75
    if Alpha < 1 / D1 then return N1 * Alpha * Alpha
    elseif Alpha < 2 / D1 then Alpha = Alpha - 1.5 / D1; return N1 * Alpha * Alpha + 0.75
    elseif Alpha < 2.5 / D1 then Alpha = Alpha - 2.25 / D1; return N1 * Alpha * Alpha + 0.9375
    else Alpha = Alpha - 2.625 / D1; return N1 * Alpha * Alpha + 0.984375 end
end

local function _NyxEaseIn(Alpha, Style)
    local S = _NyxEnumName(Style, "Linear")
    if S == "Linear" then return Alpha end
    if S == "Sine" then return 1 - math.cos((Alpha * math.pi) / 2) end
    if S == "Quad" then return Alpha ^ 2 end
    if S == "Cubic" then return Alpha ^ 3 end
    if S == "Quart" then return Alpha ^ 4 end
    if S == "Quint" then return Alpha ^ 5 end
    if S == "Exponential" then return Alpha == 0 and 0 or (2 ^ (10 * Alpha - 10)) end
    if S == "Circular" then return 1 - math.sqrt(math.max(0, 1 - Alpha * Alpha)) end
    if S == "Back" then
        local C1 = 1.70158
        return (C1 + 1) * Alpha ^ 3 - C1 * Alpha ^ 2
    end
    if S == "Elastic" then
        if Alpha == 0 or Alpha == 1 then return Alpha end
        local C4 = (2 * math.pi) / 3
        return -(2 ^ (10 * Alpha - 10)) * math.sin((Alpha * 10 - 10.75) * C4)
    end
    if S == "Bounce" then return 1 - _NyxBounceOut(1 - Alpha) end
    return Alpha
end

local function _NyxEase(Alpha, Style, Direction)
    Alpha = math.clamp(Alpha, 0, 1)
    local Dir = _NyxEnumName(Direction, "Out")
    if Dir == "Out" then
        local S = _NyxEnumName(Style, "Linear")
        if S == "Bounce" then return _NyxBounceOut(Alpha) end
        return 1 - _NyxEaseIn(1 - Alpha, Style)
    end
    if Dir == "InOut" then
        if Alpha < 0.5 then return _NyxEaseIn(Alpha * 2, Style) / 2 end
        if _NyxEnumName(Style, "Linear") == "Bounce" then return (1 + _NyxBounceOut(Alpha * 2 - 1)) / 2 end
        return 1 - _NyxEaseIn((1 - Alpha) * 2, Style) / 2
    end
    return _NyxEaseIn(Alpha, Style)
end

local function _NyxLerp(A, B, Alpha)
    if type(A) == "number" and type(B) == "number" then return A + (B - A) * Alpha end
    local MT = getmetatable(B)
    if MT == Vector3 or MT == Vector2 or MT == Color3 or MT == CFrame or MT == UDim2 then
        return A:Lerp(B, Alpha)
    end
    return Alpha >= 1 and B or A
end

TweenService = _NyxMakeServiceInstance("TweenService", "Service")
rawset(_Data(TweenService), "Name", "TweenService")

function _NyxInstanceMethods.Create(Self, Target, Info, Goals)
    Info = Info or TweenInfo.new(1)
    Goals = Goals or {}
    local Starts = {}
    for K in pairs(Goals) do Starts[K] = Target[K] end

    local CompletedSignal = _NyxNewSignal()
    local Tween = {
        Instance = Target,
        TweenInfo = Info,
        Completed = CompletedSignal,
        PlaybackState = Enum.PlaybackState.Begin,
    }
    function Tween:Play()
        local Duration = math.max(Info.Time or 1, 0.0001)
        local LocalTime = (_NYX_LIVE_TIME or 0) - (Info.DelayTime or 0)
        if LocalTime < 0 then self.PlaybackState = Enum.PlaybackState.Delayed; return end
        local RepeatCount = Info.RepeatCount or 0
        local Cycle = math.floor(LocalTime / Duration)
        if RepeatCount >= 0 and Cycle > RepeatCount then LocalTime = Duration; Cycle = RepeatCount end
        local Alpha = (LocalTime % Duration) / Duration
        if RepeatCount >= 0 and Cycle == RepeatCount and LocalTime >= Duration then Alpha = 1 end
        if Info.Reverses and Cycle % 2 == 1 then Alpha = 1 - Alpha end
        Alpha = _NyxEase(Alpha, Info.EasingStyle, Info.EasingDirection)
        self.PlaybackState = (Alpha >= 1 and not Info.Reverses)
            and Enum.PlaybackState.Completed or Enum.PlaybackState.Playing
        for K, V in pairs(Goals) do Target[K] = _NyxLerp(Starts[K], V, Alpha) end
        if self.PlaybackState == Enum.PlaybackState.Completed then
            CompletedSignal:Fire(Enum.PlaybackState.Completed)
        end
    end
    function Tween:Cancel() self.PlaybackState = Enum.PlaybackState.Cancelled end
    function Tween:Pause() self.PlaybackState = Enum.PlaybackState.Paused end
    return Tween
end
function _NyxInstanceMethods.GetValue(_Self, Alpha, Style, Direction)
    return _NyxEase(Alpha or 0, Style, Direction)
end

RunService = _NyxMakeServiceInstance("RunService", "Service")
do
    local RD = _Data(RunService)
    rawset(RD, "Name", "RunService")
end
RunService.Heartbeat = _NyxNewSignal()
RunService.RenderStepped = _NyxNewSignal()
RunService.Stepped = _NyxNewSignal()
RunService.PreRender = RunService.RenderStepped
RunService.PreSimulation = RunService.Stepped
RunService.PostSimulation = RunService.Heartbeat
RunService.PreAnimation = RunService.Stepped

local _HeartbeatConnect = RunService.Heartbeat.Connect
RunService.Heartbeat.Connect = function(SelfSig, Callback)
    _NYX_HEARTBEAT_CALLBACKS[#_NYX_HEARTBEAT_CALLBACKS + 1] = Callback
    return _HeartbeatConnect(SelfSig, Callback)
end
RunService.Heartbeat.connect = RunService.Heartbeat.Connect

function RunService:IsClient() return true end
function RunService:IsServer() return false end
function RunService:IsStudio() return true end
function RunService:IsRunning() return true end
function RunService:IsEdit() return false end
function RunService:BindToRenderStep(_Name, _Priority, Fn)
    _NYX_HEARTBEAT_CALLBACKS[#_NYX_HEARTBEAT_CALLBACKS + 1] = function(Dt) Fn(Dt) end
end
function RunService:UnbindFromRenderStep(_Name) end

function _nyx_step_live(DeltaTime)
    for _, Callback in ipairs(_NYX_HEARTBEAT_CALLBACKS) do
        pcall(Callback, DeltaTime or 0)
    end
end

local _HttpService = _NyxMakeServiceInstance("HttpService", "Service")
rawset(_Data(_HttpService), "Name", "HttpService")
function _NyxInstanceMethods.JSONEncode(_Self, T) return _nyx_json_encode(T) end
function _NyxInstanceMethods.JSONDecode(_Self, S) return _nyx_json_decode(S) end
function _NyxInstanceMethods.GenerateGUID(_Self, Wrap)
    local function Hex(N)
        local S = ""
        for _ = 1, N do S = S .. string.format("%x", math.random(0, 15)) end
        return S
    end
    local G = Hex(8) .. "-" .. Hex(4) .. "-4" .. Hex(3) .. "-" .. Hex(4) .. "-" .. Hex(12)
    if Wrap == false then return G end
    return "{" .. G .. "}"
end
function _NyxInstanceMethods.UrlEncode(_Self, S)
    return (tostring(S):gsub("[^%w]", function(C) return string.format("%%%02X", C:byte()) end))
end

local _CollectionService = _NyxMakeServiceInstance("CollectionService", "Service")
rawset(_Data(_CollectionService), "Name", "CollectionService")
local _TagRegistry = {}
function _NyxInstanceMethods.GetTagged(_Self, Tag)
    local Out = {}
    for Inst in pairs(_TagRegistry[Tag] or {}) do Out[#Out + 1] = Inst end
    return Out
end
function _NyxInstanceMethods.GetInstanceAddedSignal(Self, Tag)
    return _Data(Self)._getSignal("__tagadd_" .. Tag)
end
function _NyxInstanceMethods.GetInstanceRemovedSignal(Self, Tag)
    return _Data(Self)._getSignal("__tagrem_" .. Tag)
end
function _NyxInstanceMethods.CollectionAddTag(_Self, Inst, Tag)
    _NyxInstanceMethods.AddTag(Inst, Tag)
    _TagRegistry[Tag] = _TagRegistry[Tag] or {}
    _TagRegistry[Tag][Inst] = true
end


local _Debris = _NyxMakeServiceInstance("Debris", "Service")
rawset(_Data(_Debris), "Name", "Debris")
function _NyxInstanceMethods.AddItem(_Self, Item, _Lifetime)
    return Item
end

local _Players = _NyxMakeServiceInstance("Players", "Service")
do
    local PD = _Data(_Players)
    rawset(PD, "Name", "Players")
    rawset(PD, "LocalPlayer", nil)
    rawset(PD, "MaxPlayers", 10)
    rawset(PD, "NumPlayers", 0)
end
_Players.PlayerAdded = _NyxNewSignal()
_Players.PlayerRemoving = _NyxNewSignal()
function _NyxInstanceMethods.GetPlayers(_Self) return {} end
function _NyxInstanceMethods.GetPlayerFromCharacter(_Self, _Char) return nil end
function _NyxInstanceMethods.GetPlayerByUserId(_Self, _Id) return nil end

_Services.Workspace = _WorkspaceInstance
_Services.Lighting = _LightingInstance
_Services.RunService = RunService
_Services.TweenService = TweenService
_Services.HttpService = _HttpService
_Services.CollectionService = _CollectionService
_Services.Debris = _Debris
_Services.Players = _Players

local _GenericServiceClasses = {
    "ReplicatedStorage", "ReplicatedFirst", "ServerStorage", "ServerScriptService",
    "StarterGui", "StarterPack", "StarterPlayer", "SoundService", "Teams",
    "Chat", "TextChatService", "MarketplaceService", "DataStoreService",
    "UserInputService", "ContextActionService", "GuiService", "PhysicsService",
    "PathfindingService", "TextService", "LocalizationService", "TeleportService",
    "BadgeService", "GamePassService", "InsertService", "AssetService",
    "TestService", "LogService", "StatsService", "ProximityPromptService",
    "MaterialService", "VoiceChatService", "CollectionService",
}

function _NyxGetService(Name)
    if Name == "workspace" then Name = "Workspace" end
    if _Services[Name] then return _Services[Name] end
    local Svc = _NyxMakeServiceInstance(Name, "Service")
    rawset(_Data(Svc), "Name", Name)
    _Services[Name] = Svc
    return Svc
end
for _, Name in ipairs(_GenericServiceClasses) do _NyxGetService(Name) end

do
    local UIS = _NyxGetService("UserInputService")
    UIS.InputBegan = _NyxNewSignal()
    UIS.InputEnded = _NyxNewSignal()
    UIS.InputChanged = _NyxNewSignal()
    UIS.TouchStarted = _NyxNewSignal()
    rawset(_Data(UIS), "TouchEnabled", false)
    rawset(_Data(UIS), "KeyboardEnabled", true)
    rawset(_Data(UIS), "MouseEnabled", true)
end
function _NyxInstanceMethods.IsKeyDown(_Self, _Key) return false end
function _NyxInstanceMethods.IsMouseButtonPressed(_Self, _Btn) return false end
function _NyxInstanceMethods.GetMouseLocation(_Self) return Vector2.zero end
function _NyxInstanceMethods.BindAction(_Self) end
function _NyxInstanceMethods.UnbindAction(_Self) end

game = _NyxMakeServiceInstance("DataModel", "DataModel")
do
    local GD = _Data(game)
    rawset(GD, "Name", "game")
    rawset(GD, "Workspace", _WorkspaceInstance)
    rawset(GD, "workspace", _WorkspaceInstance)
    rawset(GD, "Lighting", _LightingInstance)
    rawset(GD, "PlaceId", 0)
    rawset(GD, "GameId", 0)
    rawset(GD, "JobId", "")
    rawset(GD, "CreatorId", 0)
end
function _NyxInstanceMethods.FindService(_Self, Name) return _Services[Name] end
function _NyxInstanceMethods.GetObjects(_Self) return {} end
function _NyxInstanceMethods.IsLoaded(_Self) return true end
function _NyxInstanceMethods.BindToClose(_Self, _Fn) end

task = {}
function task.wait(Seconds) return Seconds or 0 end
function task.spawn(Fn, ...) local Co = coroutine.create(Fn); coroutine.resume(Co, ...); return Co end
function task.defer(Fn, ...) return task.spawn(Fn, ...) end
function task.delay(_Seconds, Fn, ...) return task.spawn(Fn, ...) end
function task.cancel(_Co) end
function task.synchronize() end
function task.desynchronize() end

function wait(Seconds) return Seconds or 0, _NYX_LIVE_TIME or 0 end
function delay(_Seconds, Fn) if Fn then pcall(Fn) end end
function spawn(Fn) if Fn then task.spawn(Fn) end end
function tick() return _NYX_LIVE_TIME or 0 end
function time() return _NYX_LIVE_TIME or 0 end
function elapsedTime() return _NYX_LIVE_TIME or 0 end

if not warn then
    function warn(...)
        local Parts = {}
        for _, V in ipairs({ ... }) do Parts[#Parts + 1] = tostring(V) end
        print("[warn] " .. table.concat(Parts, "\t"))
    end
end

if not _NYX_REAL_REQUIRE then
    _NYX_REAL_REQUIRE = require
    require = function(Target)
        if type(Target) == "table" and Target._isInstance then return {} end
        local Ok, Result = pcall(_NYX_REAL_REQUIRE, Target)
        if Ok then return Result end
        return {}
    end
end

Random = {}
Random.__index = Random
function Random.new(Seed)
    local R = setmetatable({ _state = Seed or os.time() }, Random)
    return R
end
function Random:NextNumber(Min, Max)
    local N = math.random()
    if Min and Max then return Min + N * (Max - Min) end
    return N
end
function Random:NextInteger(Min, Max) return math.random(Min or 0, Max or 1) end
function Random:NextUnitVector()
    local Theta = math.random() * 2 * math.pi
    local Z = math.random() * 2 - 1
    local R = math.sqrt(1 - Z * Z)
    return Vector3.new(R * math.cos(Theta), R * math.sin(Theta), Z)
end
function Random:Clone() return Random.new(self._state) end
function Random:Shuffle(T)
    for I = #T, 2, -1 do
        local J = math.random(I)
        T[I], T[J] = T[J], T[I]
    end
end

if not newproxy then
    function newproxy(AddMeta)
        if AddMeta then return setmetatable({}, {}) end
        return {}
    end
end
function settings() return { Rendering = {}, Physics = {}, Network = {} } end
function UserSettings() return { GameSettings = {} } end
