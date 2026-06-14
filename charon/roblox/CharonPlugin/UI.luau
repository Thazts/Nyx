local UI = {}
UI.__index = UI

export type UI = typeof(setmetatable(
	{} :: {
		Toolbar: PluginToolbar,
		ConnectButton: PluginToolbarButton,
		PushButton: PluginToolbarButton,
		LiveSyncButton: PluginToolbarButton,
	},
	UI
))

function UI.new(Plugin: Plugin): UI
	local Toolbar = Plugin:CreateToolbar("Charon")
	return setmetatable({
		Toolbar = Toolbar,
		ConnectButton = Toolbar:CreateButton(
			"Connect",
			"Check the connection to the Nyx Charon ferry",
			""
		),
		PushButton = Toolbar:CreateButton(
			"Push Selection",
			"Ferry the selected scripts across to Nyx",
			""
		),
		LiveSyncButton = Toolbar:CreateButton(
			"Live Sync",
			"Continuously pull Nyx's changes into this session",
			""
		),
	}, UI)
end

function UI:OnConnect(Callback: () -> ())
	self.ConnectButton.Click:Connect(Callback)
end

function UI:OnPush(Callback: () -> ())
	self.PushButton.Click:Connect(Callback)
end

function UI:OnLiveSync(Callback: () -> ())
	self.LiveSyncButton.Click:Connect(Callback)
end

function UI:SetLiveSyncActive(Active: boolean)
	self.LiveSyncButton:SetActive(Active)
end

return UI
