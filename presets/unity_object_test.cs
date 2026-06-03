using UnityEngine;

public sealed class NyxUnityObjectTest
{
    public void Start()
    {
        Scene.SetGravity(9.81f);

        var Ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Ground.Name = "Unity Ground";
        Ground.Transform.Position = new Vector3(0f, -0.5f, 0f);
        Ground.Transform.LocalScale = new Vector3(32f, 1f, 32f);
        Ground.Color = new Color(0.30f, 0.52f, 0.34f);
        Ground.Material = "Concrete";

        var Cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Cube.Name = "Unity Rigidbody Cube";
        Cube.Transform.Position = new Vector3(-3.5f, 5.5f, 0f);
        Cube.Transform.LocalScale = new Vector3(1.6f, 1.6f, 1.6f);
        Cube.Color = new Color(0.85f, 0.44f, 0.24f);
        var Body = Cube.AddComponent<Rigidbody>();
        Body.Mass = 2f;
        Body.Velocity = new Vector3(2.6f, 0f, 0f);

        var Sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        Sphere.Name = "Unity Impulse Sphere";
        Sphere.Transform.Position = new Vector3(3f, 8f, 0f);
        Sphere.Transform.LocalScale = new Vector3(1.8f, 1.8f, 1.8f);
        Sphere.Color = new Color(0.42f, 0.70f, 0.98f);
        Sphere.AddComponent<Rigidbody>().AddForce(new Vector3(-4f, 7f, 0f), ForceMode.Impulse);

        Scene.AddDirectionalLight(new Vector3(5f, 10f, 6f), new Color(1f, 0.96f, 0.86f), 1.2f);
        Camera.SetPosition(new Vector3(12f, 8f, 12f), new Vector3(0f, 2f, 0f));
    }
}

/*
@nyx-scene
[
  { "Cmd": "SetGravity", "Value": 9.81 },
  { "Cmd": "SetSkybox", "Color": { "R": 0.32, "G": 0.42, "B": 0.55 } },
  { "Cmd": "AddPart", "Id": "UnityGround", "Name": "Unity Ground", "Position": { "X": 0, "Y": -0.5, "Z": 0 }, "Size": { "X": 32, "Y": 1, "Z": 32 }, "Color": { "R": 0.30, "G": 0.52, "B": 0.34 }, "CFrame": { "X": 0, "Y": -0.5, "Z": 0, "RX": 0, "RY": 0, "RZ": 0 }, "Anchored": true, "CanCollide": true, "Transparency": 0, "Material": "Concrete", "Shape": "Block" },
  { "Cmd": "AddPart", "Id": "UnityCube", "Name": "Unity Rigidbody Cube", "Position": { "X": -3.5, "Y": 5.5, "Z": 0 }, "Size": { "X": 1.6, "Y": 1.6, "Z": 1.6 }, "Color": { "R": 0.85, "G": 0.44, "B": 0.24 }, "CFrame": { "X": -3.5, "Y": 5.5, "Z": 0, "RX": 0, "RY": 0, "RZ": 0 }, "Anchored": false, "CanCollide": true, "Transparency": 0, "Material": "Default", "Shape": "Block", "Mass": 2, "AssemblyLinearVelocity": { "X": 2.6, "Y": 0, "Z": 0 } },
  { "Cmd": "AddPart", "Id": "UnitySphere", "Name": "Unity Impulse Sphere", "Position": { "X": 3, "Y": 8, "Z": 0 }, "Size": { "X": 1.8, "Y": 1.8, "Z": 1.8 }, "Color": { "R": 0.42, "G": 0.70, "B": 0.98 }, "CFrame": { "X": 3, "Y": 8, "Z": 0, "RX": 0, "RY": 0, "RZ": 0 }, "Anchored": false, "CanCollide": true, "Transparency": 0, "Material": "Default", "Shape": "Sphere", "Impulse": { "X": -4, "Y": 7, "Z": 0 } },
  { "Cmd": "AddLight", "LightType": "Directional", "Position": { "X": 5, "Y": 10, "Z": 6 }, "Color": { "R": 1, "G": 0.96, "B": 0.86 }, "Intensity": 1.2 },
  { "Cmd": "SetCamera", "Position": { "X": 12, "Y": 8, "Z": 12 }, "LookAt": { "X": 0, "Y": 2, "Z": 0 } }
]
*/
