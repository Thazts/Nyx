// Nyx Engine - Unity Runtime Shim
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace UnityEngine
{
    public struct Vector3
    {
        public float X;
        public float Y;
        public float Z;

        public Vector3(float X, float Y, float Z)
        {
            this.X = X;
            this.Y = Y;
            this.Z = Z;
        }

        public static Vector3 Zero => new Vector3(0f, 0f, 0f);
        public static Vector3 One => new Vector3(1f, 1f, 1f);
        public static Vector3 Up => new Vector3(0f, 1f, 0f);
        public static Vector3 Down => new Vector3(0f, -1f, 0f);
        public static Vector3 Right => new Vector3(1f, 0f, 0f);
        public static Vector3 Forward => new Vector3(0f, 0f, 1f);

        public static Vector3 operator +(Vector3 A, Vector3 B) => new Vector3(A.X + B.X, A.Y + B.Y, A.Z + B.Z);
        public static Vector3 operator -(Vector3 A, Vector3 B) => new Vector3(A.X - B.X, A.Y - B.Y, A.Z - B.Z);
        public static Vector3 operator *(Vector3 A, float B) => new Vector3(A.X * B, A.Y * B, A.Z * B);
        public static Vector3 operator *(float A, Vector3 B) => B * A;
        public static Vector3 operator /(Vector3 A, float B) => new Vector3(A.X / B, A.Y / B, A.Z / B);
    }

    public struct Color
    {
        public float R;
        public float G;
        public float B;
        public float A;

        public Color(float R, float G, float B, float A = 1f)
        {
            this.R = R;
            this.G = G;
            this.B = B;
            this.A = A;
        }

        public static Color White => new Color(1f, 1f, 1f);
        public static Color Gray => new Color(0.64f, 0.64f, 0.65f);
        public static Color Red => new Color(1f, 0f, 0f);
        public static Color Green => new Color(0f, 1f, 0f);
        public static Color Blue => new Color(0f, 0f, 1f);
    }

    public struct Quaternion
    {
        public float X;
        public float Y;
        public float Z;
        public float W;

        public Quaternion(float X, float Y, float Z, float W)
        {
            this.X = X;
            this.Y = Y;
            this.Z = Z;
            this.W = W;
        }

        public static Quaternion Identity => new Quaternion(0f, 0f, 0f, 1f);

        public static Quaternion Euler(float X, float Y, float Z)
        {
            return new Quaternion(X, Y, Z, 1f);
        }
    }

    public sealed class Transform
    {
        public Vector3 Position = Vector3.Zero;
        public Vector3 LocalScale = Vector3.One;
        public Quaternion Rotation = Quaternion.Identity;
    }

    public enum PrimitiveType
    {
        Cube,
        Sphere,
        Cylinder,
        Capsule,
        Plane,
        Quad
    }

    public enum ForceMode
    {
        Force,
        Acceleration,
        Impulse,
        VelocityChange
    }

    public sealed class Rigidbody
    {
        public float Mass = 1f;
        public float Drag = 0f;
        public float AngularDrag = 0.05f;
        public bool UseGravity = true;
        public bool IsKinematic = false;
        public Vector3 Velocity = Vector3.Zero;
        public Vector3 AngularVelocity = Vector3.Zero;
        internal Vector3 Force = Vector3.Zero;
        internal Vector3 Impulse = Vector3.Zero;

        public void AddForce(Vector3 Force, ForceMode Mode = ForceMode.Force)
        {
            if (Mode == ForceMode.Impulse || Mode == ForceMode.VelocityChange)
            {
                Impulse += Mode == ForceMode.VelocityChange ? Force * Math.Max(Mass, 0.001f) : Force;
                Velocity += Force / Math.Max(Mass, 0.001f);
                return;
            }
            this.Force += Mode == ForceMode.Acceleration ? Force * Math.Max(Mass, 0.001f) : Force;
        }
    }

    public sealed class GameObject
    {
        private static int NextId = 0;

        public readonly string NyxId;
        public string Name;
        public Transform Transform = new Transform();
        public bool ActiveSelf = true;
        public PrimitiveType Shape = PrimitiveType.Cube;
        public Color Color = Color.Gray;
        public string Material = "Default";
        public Rigidbody Rigidbody;

        public GameObject(string Name = "GameObject")
        {
            NextId++;
            NyxId = "UnityObject_" + NextId.ToString(CultureInfo.InvariantCulture);
            this.Name = Name;
        }

        public static GameObject CreatePrimitive(PrimitiveType Type)
        {
            var Object = new GameObject(Type.ToString());
            Object.Shape = Type;
            Scene.Add(Object);
            return Object;
        }

        public T AddComponent<T>() where T : class, new()
        {
            var Component = new T();
            if (Component is Rigidbody Body)
            {
                Rigidbody = Body;
            }
            return Component;
        }

        public T GetComponent<T>() where T : class
        {
            if (typeof(T) == typeof(Rigidbody))
            {
                return Rigidbody as T;
            }
            return null;
        }
    }

    public static class Physics
    {
        public static Vector3 Gravity = new Vector3(0f, -9.81f, 0f);
        public static int DefaultSolverIterations = 6;
        public static float DefaultContactOffset = 0.01f;
    }

    public static class Time
    {
        public static float FixedDeltaTime = 0.02f;
        public static float DeltaTime = 0.02f;
        public static float TimeSinceStartup = 0f;
    }

    public static class Debug
    {
        public static void Log(object Message)
        {
            NyxRuntime.Terminal.Add(Message == null ? "null" : Message.ToString());
        }
    }

    public static class Camera
    {
        public static void SetPosition(Vector3 Position, Vector3 LookAt)
        {
            // { Cmd, Position, LookAt }
            NyxRuntime.Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "SetCamera",
                ["Position"] = NyxRuntime.Vec(Position),
                ["LookAt"] = NyxRuntime.Vec(LookAt),
            });
        }
    }

    public static class Scene
    {
        public static readonly List<GameObject> Objects = new List<GameObject>();

        public static GameObject Add(GameObject Object)
        {
            if (!Objects.Contains(Object))
            {
                Objects.Add(Object);
            }
            return Object;
        }

        public static void SetGravity(float Value)
        {
            Physics.Gravity = new Vector3(0f, -Value, 0f);
            // { Cmd, Value }
            NyxRuntime.Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "SetGravity",
                ["Value"] = Value,
            });
        }

        public static void SetSkybox(Color Color)
        {
            // { Cmd, Color }
            NyxRuntime.Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "SetSkybox",
                ["Color"] = NyxRuntime.Colour(Color),
            });
        }

        public static void AddDirectionalLight(Vector3 Position, Color Color, float Intensity = 1f)
        {
            // { Cmd, LightType, Position, Color, Intensity }
            NyxRuntime.Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "AddLight",
                ["LightType"] = "Directional",
                ["Position"] = NyxRuntime.Vec(Position),
                ["Color"] = NyxRuntime.Colour(Color),
                ["Intensity"] = Intensity,
            });
        }
    }

    public static class NyxRuntime
    {
        public static readonly List<Dictionary<string, object>> Commands = new List<Dictionary<string, object>>();
        public static readonly List<string> Terminal = new List<string>();

        public static Dictionary<string, object> Vec(Vector3 Value)
        {
            // { X, Y, Z }
            return new Dictionary<string, object>
            {
                ["X"] = Value.X,
                ["Y"] = Value.Y,
                ["Z"] = Value.Z,
            };
        }

        public static Dictionary<string, object> Colour(Color Value)
        {
            // { R, G, B }
            return new Dictionary<string, object>
            {
                ["R"] = Value.R,
                ["G"] = Value.G,
                ["B"] = Value.B,
            };
        }

        public static Dictionary<string, object> Frame(Transform Transform)
        {
            // { X, Y, Z, RX, RY, RZ }
            return new Dictionary<string, object>
            {
                ["X"] = Transform.Position.X,
                ["Y"] = Transform.Position.Y,
                ["Z"] = Transform.Position.Z,
                ["RX"] = Transform.Rotation.X,
                ["RY"] = Transform.Rotation.Y,
                ["RZ"] = Transform.Rotation.Z,
            };
        }

        public static void EmitGameObject(GameObject Object)
        {
            UpsertCommand(GameObjectCommand(Object));
        }

        public static string CommandsToJson()
        {
            return ToJson(BuildCommands());
        }

        private static List<Dictionary<string, object>> BuildCommands()
        {
            var Output = new List<Dictionary<string, object>>(Commands);
            foreach (var Object in Scene.Objects)
            {
                Output.RemoveAll(Command =>
                    Command.TryGetValue("Cmd", out var Cmd) && (Cmd as string) == "AddPart" &&
                    Command.TryGetValue("Id", out var Id) && (Id as string) == Object.NyxId);
                Output.Add(GameObjectCommand(Object));
            }
            return Output;
        }

        private static void UpsertCommand(Dictionary<string, object> Command)
        {
            if (!Command.TryGetValue("Id", out var Id))
            {
                Commands.Add(Command);
                return;
            }

            for (var I = 0; I < Commands.Count; I++)
            {
                if (Commands[I].TryGetValue("Cmd", out var Cmd) && (Cmd as string) == "AddPart" &&
                    Commands[I].TryGetValue("Id", out var ExistingId) && (ExistingId as string) == (Id as string))
                {
                    Commands[I] = Command;
                    return;
                }
            }

            Commands.Add(Command);
        }

        private static Dictionary<string, object> GameObjectCommand(GameObject Object)
        {
            var Body = Object.Rigidbody;
            var Shape = Object.Shape == PrimitiveType.Sphere ? "Sphere"
                : Object.Shape == PrimitiveType.Cylinder || Object.Shape == PrimitiveType.Capsule ? "Cylinder"
                : "Block";

            // { Cmd, Id, Name, Position, Size, Color, CFrame, Anchored, CanCollide, Transparency, Material, Shape, AssemblyLinearVelocity, AssemblyAngularVelocity, Force, Impulse, Massless, Mass, Density, Friction, Elasticity }
            return new Dictionary<string, object>
            {
                ["Cmd"] = "AddPart",
                ["Id"] = Object.NyxId,
                ["Name"] = Object.Name,
                ["Position"] = Vec(Object.Transform.Position),
                ["Size"] = Vec(Object.Transform.LocalScale),
                ["Color"] = Colour(Object.Color),
                ["CFrame"] = Frame(Object.Transform),
                ["Anchored"] = Body == null || Body.IsKinematic,
                ["CanCollide"] = Object.ActiveSelf,
                ["Transparency"] = 0f,
                ["Material"] = Object.Material,
                ["Shape"] = Shape,
                ["AssemblyLinearVelocity"] = Vec(Body == null ? Vector3.Zero : Body.Velocity),
                ["Velocity"] = Vec(Body == null ? Vector3.Zero : Body.Velocity),
                ["AssemblyAngularVelocity"] = Vec(Body == null ? Vector3.Zero : Body.AngularVelocity),
                ["RotVelocity"] = Vec(Body == null ? Vector3.Zero : Body.AngularVelocity),
                ["Force"] = Vec(Body == null ? Vector3.Zero : Body.Force),
                ["Impulse"] = Vec(Body == null ? Vector3.Zero : Body.Impulse),
                ["Massless"] = false,
                ["Mass"] = Body == null ? 0f : Body.Mass,
                ["Density"] = 1f,
                ["Friction"] = 0.6f,
                ["Elasticity"] = 0f,
            };
        }

        public static string ToJson(object Value)
        {
            if (Value == null) return "null";
            if (Value is bool Bool) return Bool ? "true" : "false";
            if (Value is int Int) return Int.ToString(CultureInfo.InvariantCulture);
            if (Value is float Float) return Float.ToString("0.########", CultureInfo.InvariantCulture);
            if (Value is double Double) return Double.ToString("0.########", CultureInfo.InvariantCulture);
            if (Value is string String) return "\"" + String.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
            if (Value is Dictionary<string, object> Object)
            {
                var Parts = new List<string>();
                foreach (var Pair in Object)
                {
                    Parts.Add(ToJson(Pair.Key) + ":" + ToJson(Pair.Value));
                }
                return "{" + string.Join(",", Parts) + "}";
            }
            if (Value is IEnumerable<Dictionary<string, object>> CommandList)
            {
                var Parts = new List<string>();
                foreach (var Command in CommandList)
                {
                    Parts.Add(ToJson(Command));
                }
                return "[" + string.Join(",", Parts) + "]";
            }
            return ToJson(Value.ToString());
        }
    }
}
