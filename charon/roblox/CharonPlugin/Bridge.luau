local HttpService = game:GetService("HttpService")

local PROTOCOL_VERSION = 2

local Bridge = {}
Bridge.__index = Bridge

export type Bridge = typeof(setmetatable(
	{} :: {
		Host: string,
		Connected: boolean,
		Session: string?,
	},
	Bridge
))

function Bridge.new(Host: string): Bridge
	return setmetatable({
		Host = Host,
		Connected = false,
		Session = nil,
	}, Bridge)
end

function Bridge:Request(Method: string, Path: string, Body: any?): (string?, string?)
	local Ok, Result = pcall(function()
		return HttpService:RequestAsync({
			Url = self.Host .. Path,
			Method = Method,
			Headers = { ["Content-Type"] = "application/json" },
			Body = if Body ~= nil then HttpService:JSONEncode(Body) else nil,
		})
	end)

	if not Ok then
		return nil, tostring(Result)
	end
	if not Result.Success then
		return nil, ("Charon returned %d: %s"):format(Result.StatusCode, tostring(Result.Body))
	end
	return Result.Body, nil
end

local function DecodeJson(Body: string): (any?, string?)
	local Ok, Value = pcall(function()
		return HttpService:JSONDecode(Body)
	end)
	if not Ok then
		return nil, "malformed JSON from Charon"
	end
	return Value, nil
end

function Bridge:Connect(): (boolean, any)
	local Body, Err = self:Request("GET", "/")
	if not Body then
		self.Connected = false
		return false, Err or "no response"
	end

	local Info = DecodeJson(Body)
	if typeof(Info) ~= "table" then
		self.Connected = false
		return false, "malformed handshake"
	end
	if Info.protocol ~= PROTOCOL_VERSION then
		self.Connected = false
		return false,
			("protocol mismatch — plugin expects v%d, ferry is v%s")
				:format(PROTOCOL_VERSION, tostring(Info.protocol))
	end

	self.Connected = true
	self.Session = tostring(Info.session)
	return true, Info
end

function Bridge:Push(Payload): (boolean, string?)
	local _, Err = self:Request("POST", "/push", Payload)
	if Err then
		return false, Err
	end
	return true, nil
end

function Bridge:Pull(Cursor: number): (any?, string?)
	local Body, Err = self:Request("GET", "/pull?cursor=" .. tostring(Cursor))
	if not Body then
		self.Connected = false
		return nil, Err or "no response"
	end
	local Payload, DecodeErr = DecodeJson(Body)
	if not Payload then
		return nil, DecodeErr
	end
	return Payload, nil
end

return Bridge
