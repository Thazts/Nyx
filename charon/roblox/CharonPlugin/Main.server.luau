local Selection = game:GetService("Selection")

local Bridge = require(script.Parent.Bridge)
local Serializer = require(script.Parent.Serializer)
local Applier = require(script.Parent.Applier)
local UI = require(script.Parent.UI)

local CHARON_HOST = "http://localhost:34777"
local POLL_INTERVAL = 0.75
local MAX_BACKOFF = 8

local Ferry = Bridge.new(CHARON_HOST)
local Interface = UI.new(plugin)

local Cursor = 0
local SyncSession: string? = nil
local LiveSyncOn = false
local SyncEpoch = 0

local function ResetCursor(Session: string?)
	Cursor = 0
	SyncSession = Session
end

local function ReflectLiveSync(Active: boolean)
	pcall(function()
		Interface:SetLiveSyncActive(Active)
	end)
end

local function EnsureConnected(): boolean
	if Ferry.Connected then
		return true
	end
	local Ok, InfoOrErr = Ferry:Connect()
	if Ok then
		print(("[Charon] Connected — protocol v2, session %s."):format(tostring(Ferry.Session)))
		if typeof(Ferry.Session) == "string" and Ferry.Session ~= SyncSession then
			ResetCursor(Ferry.Session)
		end
		return true
	end
	warn("[Charon] Could not reach the ferry. Is Nyx running with Charon started? " .. tostring(InfoOrErr))
	return false
end

local function PushSelection()
	if not EnsureConnected() then
		return
	end

	local Items = Selection:Get()
	if #Items == 0 then
		warn("[Charon] Nothing selected. Select one or more scripts to ferry across.")
		return
	end

	local Payloads, Skipped = Serializer.SerializeMany(Items)
	local Pushed = 0
	for _, Payload in ipairs(Payloads) do
		local Ok, Err = Ferry:Push(Payload)
		if not Ok then
			if EnsureConnected() then
				Ok, Err = Ferry:Push(Payload)
			end
		end
		if Ok then
			Pushed += 1
		else
			warn(("[Charon] Failed to ferry %s: %s"):format(Payload.path, tostring(Err)))
		end
	end

	print(("[Charon] Ferried %d script(s) across to Nyx (%d non-script item(s) skipped)."):format(Pushed, Skipped))
end

local function PollOnce(): boolean
	for _ = 1, 2 do
		local Payload, Err = Ferry:Pull(Cursor)
		if not Payload then
			warn("[Charon] Live Sync lost the ferry: " .. tostring(Err))
			return false
		end

		local Resync = false

		if typeof(Payload.session) == "string" and Payload.session ~= SyncSession then
			if SyncSession ~= nil and Cursor ~= 0 then
				warn("[Charon] Ferry restarted (new session); resyncing from the start.")
			end
			SyncSession = Payload.session
			if Cursor ~= 0 then
				Resync = true
			end
		end

		if typeof(Payload.cursor) == "number" and Payload.cursor < Cursor then
			Resync = true
		end

		if typeof(Payload.floor) == "number" and Cursor > 0 and Cursor < Payload.floor then
			warn("[Charon] Fell behind the ferry's change window; resyncing from the start.")
			Resync = true
		end

		if Resync then
			Cursor = 0
		else
			local Applied = Applier.ApplyBatch(Payload.changes)
			if Applied > 0 then
				print(("[Charon] Applied %d change(s) from Nyx."):format(Applied))
			end
			if typeof(Payload.cursor) == "number" then
				Cursor = Payload.cursor
			end
			return true
		end
	end
	return true
end

local function StopLiveSync()
	if not LiveSyncOn then
		return
	end
	LiveSyncOn = false
	SyncEpoch += 1
	ReflectLiveSync(false)
	print("[Charon] Live Sync stopped.")
end

local function StartLiveSync()
	if LiveSyncOn then
		return
	end
	if not EnsureConnected() then
		ReflectLiveSync(false)
		return
	end

	LiveSyncOn = true
	SyncEpoch += 1
	local MyEpoch = SyncEpoch
	ReflectLiveSync(true)
	print(("[Charon] Live Sync started — pulling Nyx's changes every %ss."):format(tostring(POLL_INTERVAL)))

	task.spawn(function()
		local Backoff = POLL_INTERVAL
		while LiveSyncOn and SyncEpoch == MyEpoch do
			if PollOnce() then
				Backoff = POLL_INTERVAL
				task.wait(POLL_INTERVAL)
			else
				Backoff = math.min(Backoff * 2, MAX_BACKOFF)
				warn(("[Charon] Live Sync paused; retrying in %ds."):format(Backoff))
				task.wait(Backoff)
				if LiveSyncOn and SyncEpoch == MyEpoch then
					EnsureConnected()
				end
			end
		end
	end)
end

local function ToggleLiveSync()
	if LiveSyncOn then
		StopLiveSync()
	else
		StartLiveSync()
	end
end

Interface:OnConnect(function()
	EnsureConnected()
end)
Interface:OnPush(PushSelection)
Interface:OnLiveSync(ToggleLiveSync)
plugin.Unloading:Connect(function()
	LiveSyncOn = false
	SyncEpoch += 1
end)
