# Nyx Viewport Manual

This document describes how the Nyx viewport works: how to open it, how it selects its physics mode, how scripts interact with the 3D scene, and how engine identity is preserved across supported targets. Apply this knowledge when helping users work with the Nyx viewport or write scripts that interact with it.

---

## What the Viewport Is

The Nyx viewport is a wgpu-rendered 3D environment embedded directly in the editor. It is not a webview; it runs as a native Win32 child window layered over the UI. Its purpose is to let developers preview, test, and script 3D scenes without leaving Nyx. It renders inline with the editor panel layout and can be opened from any supported script file.

---

## Opening the Viewport

The viewport is opened from the **output bar**, the horizontal bar directly beneath the properties panel. When a file written in a supported language is open and active, a **Viewport** button appears in the output bar. Clicking it opens the scene associated with that file.

When assisting a user programmatically or through a tool call, the viewport for a specific file is opened with:

```
open_viewport:{absolute_file_path}
```

For example:
```
open_viewport:C:/Users/user/MyProject/src/game/init.luau
```

The file must be open and must be in a supported language. If the language is not recognised, the Viewport button does not appear and the command has no effect.

---

## Language Detection and Engine Mapping

Nyx determines which engine and physics mode to use based on the language of the open file. Detection is automatic; no configuration required.

| Language | Extension     | Engine Target | Physics Profile  |
|----------|---------------|---------------|------------------|
| Luau     | `.luau`, `.lua` | Roblox       | `roblox_physics` |
| C#       | `.cs`         | Unity         | `unity_physics`  |
| C++      | `.cpp`, `.h`  | Unreal Engine | `unreal_physics` |

The mapping is one-to-one. Opening a `.luau` file activates Roblox mode. Opening a `.cs` file activates Unity mode. There is no manual override; engine identity is derived from the file.

---

## Physics Profiles

All three engines share a common base physics implementation inside Nyx. On top of that base, each engine applies a physics profile that preserves its characteristic feel.

### Roblox (`roblox_physics`)
Physics feel **floaty and light**. Objects have relatively low friction, bounce gently, and respond to forces in a way that feels reminiscent of the Roblox engine. Gravity is present but not harsh. This profile is defined in `roblox_physics.rs`.

### Unity (`unity_physics`)
Physics feel **grounded and heavy**. Objects settle quickly, have more friction, and respond to gravity with a more realistic weight. This matches the expectation of a Unity developer working with Rigidbody components. This profile is defined in `unity_physics.rs`.

### Unreal Engine
Physics feel sits between the other two, responsive but not floaty, with a sense of mass. Suited to the kind of large-scale environments Unreal is typically used for.

The physics profiles exist because Nyx is not trying to be a generic renderer; it is trying to make developers feel at home in their target engine without leaving the editor. The shaders and physics together preserve that engine identity.

---

## Runtime Scripting

Scripts running inside the Nyx viewport have access to a scene API that allows creating, manipulating, and removing 3D objects at runtime. The API surface mirrors the conventions of the active engine so the transition between writing in Nyx and writing in the target engine is seamless.

### Luau (Roblox target)

3D objects are created using the Roblox `Instance` API. Parts, models, and other objects are parented into the viewport's `Workspace`.

```luau
-- Create a basic part
local Part = Instance.new("Part")
Part.Size     = Vector3.new(4, 1, 4)
Part.Position = Vector3.new(0, 5, 0)
Part.BrickColor = BrickColor.new("Bright red")
Part.Anchored = false
Part.Parent   = workspace

-- Create a model with multiple parts
local Model = Instance.new("Model")
Model.Name  = "Platform"
Model.Parent = workspace

local Base = Instance.new("Part")
Base.Size   = Vector3.new(10, 1, 10)
Base.Anchored = true
Base.Parent = Model
```

Manipulation follows the same API; set properties directly on the instance. Destroying an object removes it from the scene.

```luau
Part.Position = Vector3.new(0, 10, 0)
Part.Size     = Part.Size * 2
Part:Destroy()
```

### C# (Unity target)

Objects are created using a Unity-shaped `GameObject` API. The shim supports primitive creation, `Transform` manipulation, `Rigidbody` physics, `Renderer.material.color`, `RenderSettings`, lights, `Camera`, `Object.Destroy`, and `MonoBehaviour` helper methods. Both PascalCase fields used by Nyx presets and lower-case Unity-style aliases are supported.

```csharp
// Create a cube
GameObject Cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
Cube.transform.position = new Vector3(0, 5, 0);
Cube.transform.localScale = new Vector3(2, 2, 2);
Cube.name = "Preview Cube";

// Add physics
Rigidbody Rb = Cube.AddComponent<Rigidbody>();
Rb.mass = 1.0f;
Rb.AddForce(Vector3.up * 8.0f, ForceMode.Impulse);

// Set material color
Renderer R = Cube.GetComponent<Renderer>();
R.material.color = Color.red;

// Scene-level viewport controls
RenderSettings.skyboxColor = new Color(0.32f, 0.42f, 0.55f);
Scene.AddDirectionalLight(new Vector3(5, 10, 6), new Color(1, 0.96f, 0.86f), 1.2f);
Camera.SetPosition(new Vector3(12, 8, 12), new Vector3(0, 2, 0));
```

Destroying an object:
```csharp
Object.Destroy(Cube);
```

### C++ (Unreal target)

Objects are spawned as actors using an Unreal-shaped `UWorld` API. The shim supports `AActor`, `AStaticMeshActor`, `UStaticMeshComponent`, primitive component physics methods, `SetActorLocation`, `SetActorRotation`, `SetActorScale3D`, world gravity, skybox, camera, directional and point lights, and actor destruction through either `AActor::Destroy()` or `UWorld::DestroyActor`.

```cpp
// Spawn a static mesh actor
UWorld World;
AStaticMeshActor* MeshActor = World.SpawnActor<AStaticMeshActor>("Preview Mesh");
MeshActor->SetActorLocation(FVector(0.0f, 0.0f, 200.0f));
MeshActor->SetActorScale3D(FVector(100.0f, 100.0f, 100.0f));
MeshActor->Color = FLinearColor(0.85f, 0.48f, 0.22f);

// Enable physics simulation
UStaticMeshComponent* MeshComp = MeshActor->GetStaticMeshComponent();
MeshComp->SetSimulatePhysics(true);
MeshComp->SetMassOverrideInKg(NAME_None, 50.0f);
MeshComp->AddImpulse(FVector(0.0f, 0.0f, 900.0f));

// Scene-level viewport controls
World.SetGravityZ(-980.0f);
World.SetSkybox(FLinearColor(0.38f, 0.50f, 0.68f));
World.AddDirectionalLight(FVector(800.0f, 1200.0f, 1600.0f), FLinearColor(1.0f, 0.96f, 0.86f), 1.4f);
World.SetCamera(FVector(1800.0f, 1800.0f, 1200.0f), FVector(0.0f, 0.0f, 200.0f));
```

Destroying an actor:
```cpp
World.DestroyActor(MeshActor);
```

Unreal coordinates are converted into the Nyx scene with Unreal's Z-up convention preserved: Unreal `X` maps to Nyx `X`, Unreal `Z` maps to Nyx `Y`, and Unreal `Y` maps to Nyx `Z`.

---

## Key Constraints

- The viewport only activates for supported language files (`.luau`, `.lua`, `.cs`, `.cpp`, `.h`). Other file types will not show the Viewport button.
- Engine mode is determined at open time from the file's language. It does not change while the viewport is open.
- Runtime scripts execute inside the viewport's sandboxed environment. They cannot access the host filesystem or Nyx's internal state directly.
- C# and C++ viewport files currently load the `@nyx-scene` JSON block for execution. The Unity and Unreal shims define the supported API shape and generated-command contract, but Nyx does not yet compile and execute arbitrary C# or C++ user code in-process.
- The scene resets when the viewport is closed and reopened.
