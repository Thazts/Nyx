-- Nyx Dev: Physics Drop Test
local workspace = game:GetService("Workspace")
workspace:SetGravity(196.2)
for i = 1, 10 do
    local part = Instance.new("Part")
    part.Size = Vector3.new(2, 2, 2)
    part.Position = Vector3.new((i - 5) * 3, 10, 0)
    part.Anchored = false
    part.Parent = workspace
end
local floor = Instance.new("Part")
floor.Size = Vector3.new(40, 1, 40)
floor.Position = Vector3.new(0, 0, 0)
floor.Anchored = true
floor.Parent = workspace
print("Physics: 10 dynamic parts + floor")