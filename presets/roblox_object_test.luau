workspace:SetGravity(196.2)
workspace:SetSkybox(Color3.fromRGB(100, 148, 237))

local Ground = Instance.new("Part")
Ground.Name = "Roblox Ground"
Ground.Size = Vector3.new(32, 1, 32)
Ground.Position = Vector3.new(0, -0.5, 0)
Ground.Anchored = true
Ground.Material = Enum.Material.Grass
Ground.Color = Color3.fromRGB(74, 150, 82)
Ground.Parent = workspace

local Block = Instance.new("Part")
Block.Name = "Roblox Floaty Block"
Block.Size = Vector3.new(3, 3, 3)
Block.Position = Vector3.new(-4, 9, 0)
Block.Material = Enum.Material.SmoothPlastic
Block.Color = Color3.fromRGB(218, 132, 78)
Block.AssemblyLinearVelocity = Vector3.new(16, 0, 0)
Block.Parent = workspace

local Rubber = Instance.new("Part")
Rubber.Name = "Roblox Bouncy Rubber"
Rubber.Size = Vector3.new(2.5, 2.5, 2.5)
Rubber.Position = Vector3.new(3, 15, 0)
Rubber.Material = Enum.Material.Rubber
Rubber.Color = Color3.fromRGB(130, 190, 245)
Rubber:ApplyImpulse(Vector3.new(-70, 60, 0))
Rubber.Parent = workspace

Lighting:AddDirectionalLight({
    Position = Vector3.new(8, 18, 12),
    Color = Color3.new(1, 0.96, 0.86),
    Intensity = 1.4,
})

Camera:SetPosition(Vector3.new(24, 16, 24), Vector3.new(0, 4, 0))
