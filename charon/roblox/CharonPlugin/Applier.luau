local ChangeHistoryService = game:GetService("ChangeHistoryService")

local Applier = {}

local CONTAINER_CLASS = "Folder"

local VALID_LEAF_CLASSES = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
}

local function SafeLeafClass(Class: any): string
	if typeof(Class) == "string" and VALID_LEAF_CLASSES[Class] then
		return Class
	end
	return "ModuleScript"
end

export type Change = {
	path: string,
	class: string?,
	source: string?,
	removed: boolean?,
}

local function TryService(Name: string): Instance?
	local Ok, Service = pcall(function()
		return game:GetService(Name)
	end)
	if Ok and Service then
		return Service
	end
	return nil
end
local function EnsureContainer(Parent: Instance, Name: string): Instance?
	local Existing = Parent:FindFirstChild(Name)
	if Existing then
		return Existing
	end
	local Ok, Created = pcall(function()
		local Folder = Instance.new(CONTAINER_CLASS)
		Folder.Name = Name
		Folder.Parent = Parent
		return Folder
	end)
	if Ok then
		return Created
	end
	return nil
end
local function ResolveParent(Segments: { string }): Instance?
	local Current: Instance = game
	for Index = 2, #Segments - 1 do
		local Name = Segments[Index]
		local Next: Instance?
		if Current == game then
			Next = TryService(Name) or Current:FindFirstChild(Name)
		else
			Next = Current:FindFirstChild(Name)
		end
		if not Next then
			Next = EnsureContainer(Current, Name)
		end
		if not Next then
			return nil
		end
		Current = Next
	end
	return Current
end
function Applier.Apply(Change: Change)
	if typeof(Change) ~= "table" or typeof(Change.path) ~= "string" then
		return
	end

	local Segments = string.split(Change.path, ".")
	if #Segments < 2 then
		return
	end
	local LeafName = Segments[#Segments]
	if LeafName == "" then
		return
	end
	local Parent = ResolveParent(Segments)
	if not Parent then
		return
	end
	local Existing = Parent:FindFirstChild(LeafName)

	if Change.removed then
		if Existing then
			pcall(function()
				Existing:Destroy()
			end)
		end
		return
	end

	local Source = if typeof(Change.source) == "string" then Change.source else ""

	if Existing and Existing:IsA("LuaSourceContainer") then
		pcall(function()
			Existing.Source = Source
		end)
		return
	end

	if Existing then
		pcall(function()
			Existing:Destroy()
		end)
	end
	pcall(function()
		local Script = Instance.new(SafeLeafClass(Change.class))
		Script.Name = LeafName
		Script.Source = Source
		Script.Parent = Parent
	end)
end

function Applier.ApplyBatch(Changes: { Change }): number
	if typeof(Changes) ~= "table" or #Changes == 0 then
		return 0
	end

	ChangeHistoryService:SetWaypoint("Charon: before sync")
	for _, Change in ipairs(Changes) do
		local Ok = pcall(Applier.Apply, Change)
		if not Ok then
			warn("[Charon] Failed to apply change for " .. tostring((Change :: any).path))
		end
	end
	ChangeHistoryService:SetWaypoint("Charon: sync")
	return #Changes
end

return Applier
