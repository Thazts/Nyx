-- Nyx Dev: Part Grid Test
local workspace = game:GetService("Workspace")
for x = 0, 4 do
    for z = 0, 4 do
        local part = Instance.new("Part")
        part.Size = Vector3.new(2, 2, 2)
        part.Position = Vector3.new(x * 4, 1, z * 4)
        part.Anchored = true
        part.Parent = workspace
    end
end
print("Grid test: 25 parts loaded")