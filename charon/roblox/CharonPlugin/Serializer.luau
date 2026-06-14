local Serializer = {}

export type Payload = {
	path: string,
	class: string,
	source: string,
}

function Serializer.Serialize(Item: Instance): Payload?
	local Ok, IsScript = pcall(function()
		return Item:IsA("LuaSourceContainer")
	end)
	if not Ok or not IsScript then
		return nil
	end

	local Read, Payload = pcall(function(): Payload
		return {
			path = Item:GetFullName(),
			class = Item.ClassName,
			source = Item.Source,
		}
	end)
	if not Read then
		return nil
	end
	return Payload
end

function Serializer.SerializeMany(Items: { Instance }): ({ Payload }, number)
	local Payloads: { Payload } = {}
	local Skipped = 0
	for _, Item in ipairs(Items) do
		local Payload = Serializer.Serialize(Item)
		if Payload then
			table.insert(Payloads, Payload)
		else
			Skipped += 1
		end
	end
	return Payloads, Skipped
end

return Serializer
