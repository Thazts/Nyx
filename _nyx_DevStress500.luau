-- Nyx Dev: Stress Test 500
local workspace = game:GetService("Workspace")
local N = 500
for i = 1, N do
    local t = i / N
    local angle = t * math.pi * 20
    local part = Instance.new("Part")
    part.Size = Vector3.new(0.8, 0.8, 0.8)
    part.Position = Vector3.new(
        math.cos(angle) * (t * 24),
        t * 28,
        math.sin(angle) * (t * 24)
    )
    part.Anchored = true
    part.Parent = workspace
end
print(string.format("Stress: %d parts", N))