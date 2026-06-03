#include "NyxUnrealRuntime.h"

using namespace NyxUnreal;

void BuildNyxUnrealObjectTest(UWorld& World)
{
    World.SetGravityZ(-980.0f);

    AActor* Ground = World.SpawnActor("Unreal Ground");
    Ground->SetActorLocation(FVector(0.0f, 0.0f, -50.0f));
    Ground->SetActorScale3D(FVector(3200.0f, 3200.0f, 100.0f));
    Ground->Color = FLinearColor(0.30f, 0.42f, 0.36f);
    Ground->RootComponent->Material = "Concrete";

    AActor* Crate = World.SpawnActor("Unreal Chaos Crate");
    Crate->SetActorLocation(FVector(-350.0f, 0.0f, 520.0f));
    Crate->SetActorScale3D(FVector(160.0f, 160.0f, 160.0f));
    Crate->Color = FLinearColor(0.85f, 0.48f, 0.22f);
    Crate->RootComponent->SetSimulatePhysics(true);
    Crate->RootComponent->LinearVelocity = FVector(240.0f, 0.0f, 0.0f);

    AActor* Ball = World.SpawnActor("Unreal Impulse Sphere");
    Ball->SetActorLocation(FVector(320.0f, 0.0f, 780.0f));
    Ball->SetActorScale3D(FVector(180.0f, 180.0f, 180.0f));
    Ball->Color = FLinearColor(0.42f, 0.68f, 0.96f);
    Ball->RootComponent->Shape = "Sphere";
    Ball->RootComponent->SetSimulatePhysics(true);
    Ball->RootComponent->AddImpulse(FVector(-600.0f, 0.0f, 900.0f));

    UNyxRuntime::AddDirectionalLight(FVector(800.0f, 1200.0f, 1600.0f), FLinearColor(1.0f, 0.96f, 0.86f), 1.4f);
    UNyxRuntime::SetCamera(FVector(1800.0f, 1800.0f, 1200.0f), FVector(0.0f, 0.0f, 200.0f));
}

/*
@nyx-scene
[
  { "Cmd": "SetGravity", "Value": 980 },
  { "Cmd": "SetSkybox", "Color": { "R": 0.38, "G": 0.50, "B": 0.68 } },
  { "Cmd": "AddPart", "Id": "UnrealGround", "Name": "Unreal Ground", "Position": { "X": 0, "Y": -50, "Z": 0 }, "Size": { "X": 3200, "Y": 100, "Z": 3200 }, "Color": { "R": 0.30, "G": 0.42, "B": 0.36 }, "CFrame": { "X": 0, "Y": -50, "Z": 0, "RX": 0, "RY": 0, "RZ": 0 }, "Anchored": true, "CanCollide": true, "Transparency": 0, "Material": "Concrete", "Shape": "Block" },
  { "Cmd": "AddPart", "Id": "UnrealCrate", "Name": "Unreal Chaos Crate", "Position": { "X": -350, "Y": 520, "Z": 0 }, "Size": { "X": 160, "Y": 160, "Z": 160 }, "Color": { "R": 0.85, "G": 0.48, "B": 0.22 }, "CFrame": { "X": -350, "Y": 520, "Z": 0, "RX": 0, "RY": 0, "RZ": 0 }, "Anchored": false, "CanCollide": true, "Transparency": 0, "Material": "Default", "Shape": "Block", "AssemblyLinearVelocity": { "X": 240, "Y": 0, "Z": 0 } },
  { "Cmd": "AddPart", "Id": "UnrealSphere", "Name": "Unreal Impulse Sphere", "Position": { "X": 320, "Y": 780, "Z": 0 }, "Size": { "X": 180, "Y": 180, "Z": 180 }, "Color": { "R": 0.42, "G": 0.68, "B": 0.96 }, "CFrame": { "X": 320, "Y": 780, "Z": 0, "RX": 0, "RY": 0, "RZ": 0 }, "Anchored": false, "CanCollide": true, "Transparency": 0, "Material": "Default", "Shape": "Sphere", "Impulse": { "X": -600, "Y": 900, "Z": 0 } },
  { "Cmd": "AddLight", "LightType": "Directional", "Position": { "X": 800, "Y": 1600, "Z": 1200 }, "Color": { "R": 1, "G": 0.96, "B": 0.86 }, "Intensity": 1.4 },
  { "Cmd": "SetCamera", "Position": { "X": 1800, "Y": 1200, "Z": 1800 }, "LookAt": { "X": 0, "Y": 200, "Z": 0 } }
]
*/
