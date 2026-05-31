local workspace = game:GetService("Workspace")

local function hsv(h, s, v)
    -- h 0-1, s 0-1, v 0-1  →  Color3
    local i = math.floor(h * 6)
    local f = h * 6 - i
    local p = v * (1 - s)
    local q = v * (1 - f * s)
    local t = v * (1 - (1 - f) * s)
    local r, g, b
    local m = i % 6
    if     m == 0 then r,g,b = v,t,p
    elseif m == 1 then r,g,b = q,v,p
    elseif m == 2 then r,g,b = p,v,t
    elseif m == 3 then r,g,b = p,q,v
    elseif m == 4 then r,g,b = t,p,v
    else               r,g,b = v,p,q
    end
    return Color3.new(r, g, b)
end

local function part(pos, size, color)
    local p = Instance.new("Part")
    p.Position = pos
    p.Size     = size
    p.Color    = color
    p.Anchored = true
    p.Parent   = workspace
    return p
end

Camera:SetPosition(Vector3.new(55, 42, 55), Vector3.new(0, 10, 0))
workspace:SetSkybox(Color3.fromRGB(8, 8, 22))

for xi = 0, 16 do
    for zi = 0, 16 do
        local tx = xi / 16
        local tz = zi / 16
        part(
            Vector3.new(xi * 2 - 16, -0.25, zi * 2 - 16),
            Vector3.new(1.9, 0.5, 1.9),
            Color3.new(tx, 0.25 + tz * 0.5, 1 - tx)
        )
    end
end

local N = 120
for i = 1, N do
    local t     = i / N
    local angle = t * math.pi * 10
    local radius = 4 + t * 6
    local sz    = 0.35 + t * 1.5
    part(
        Vector3.new(math.cos(angle) * radius, 1 + t * 22, math.sin(angle) * radius),
        Vector3.new(sz, sz, sz),
        hsv(t, 0.9, 1.0)
    )
end

local RX, RZ = 28, 0
for i = 1, 24 do
    local a  = (i / 24) * math.pi * 2
    local hue = i / 24
    part(
        Vector3.new(RX + math.cos(a) * 7, 6, RZ + math.sin(a) * 7),
        Vector3.new(2, 0.6, 2),
        hsv(hue, 0.8, 0.95)
    )
end
part(Vector3.new(RX, 3, RZ), Vector3.new(1.2, 6, 1.2), Color3.fromRGB(60, 60, 100))

local TX, TZ = -28, -10
for i = 1, 14 do
    local t  = i / 14
    local w  = 5 - t * 3
    part(
        Vector3.new(TX, i * 1.8 - 0.9, TZ),
        Vector3.new(w, 1.6, w),
        hsv(t * 0.75, 0.9, 0.95)
    )
end

local debris = {
    { Vector3.new(-28, 0.5,  10), Vector3.new(7, 0.8, 7),   Color3.fromRGB(180, 100, 50) },
    { Vector3.new(-26, 3.5,  9),  Vector3.new(3, 3,   3),   Color3.fromRGB(200, 120, 60) },
    { Vector3.new(-30, 7,    11), Vector3.new(2, 2,   2),   Color3.fromRGB(220, 140, 70) },
    { Vector3.new(-27, 11,   8),  Vector3.new(1.5,1.5,1.5), Color3.fromRGB(240, 160, 80) },
    { Vector3.new(-29, 15.5, 10), Vector3.new(3, 3,   3),   Color3.fromRGB(255, 180, 90) },
    { Vector3.new(-25, 19,   12), Vector3.new(2, 2,   2),   Color3.fromRGB(255, 200,100) },
}
for _, d in ipairs(debris) do
    part(d[1], d[2], d[3])
end

for i = 1, 10 do
    local t = i / 10
    part(
        Vector3.new(i * 2.5 - 13, i * 1.2 - 0.6, 26),
        Vector3.new(2.2, i * 1.2, 2.2),
        hsv(0.58 + t * 0.15, 0.7, 0.9)
    )
end

for i = 1, 8 do
    local a   = (i / 8) * math.pi
    local ax  = math.cos(a) * 10
    local ay  = 1 + math.sin(a) * 8
    local az  = 26 + math.cos(a) * 4
    part(
        Vector3.new(ax, ay / 2, az),
        Vector3.new(1.2, ay, 1.2),
        hsv(i / 8, 0.85, 1.0)
    )
end

print(string.format(
    "Demo scene: floor(289) + helix(%d) + ring(24) + tower(14) + debris(6) + stairs(10) + arc(8) = %d parts",
    N, 289 + N + 24 + 14 + 6 + 10 + 8 + 3
))
