// Nyx Engine - Unreal Runtime Shim
#include <cmath>
#include <algorithm>
#include <iomanip>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace NyxUnreal
{
    struct FVector
    {
        float X = 0.0f;
        float Y = 0.0f;
        float Z = 0.0f;

        FVector() = default;
        FVector(float InX, float InY, float InZ) : X(InX), Y(InY), Z(InZ) {}

        FVector operator+(const FVector& Other) const { return FVector(X + Other.X, Y + Other.Y, Z + Other.Z); }
        FVector operator-(const FVector& Other) const { return FVector(X - Other.X, Y - Other.Y, Z - Other.Z); }
        FVector operator*(float Scale) const { return FVector(X * Scale, Y * Scale, Z * Scale); }
    };

    struct FRotator
    {
        float Pitch = 0.0f;
        float Yaw = 0.0f;
        float Roll = 0.0f;

        FRotator() = default;
        FRotator(float InPitch, float InYaw, float InRoll) : Pitch(InPitch), Yaw(InYaw), Roll(InRoll) {}
    };

    struct FLinearColor
    {
        float R = 1.0f;
        float G = 1.0f;
        float B = 1.0f;
        float A = 1.0f;

        FLinearColor() = default;
        FLinearColor(float InR, float InG, float InB, float InA = 1.0f) : R(InR), G(InG), B(InB), A(InA) {}
    };

    struct FTransform
    {
        FVector Location;
        FRotator Rotation;
        FVector Scale3D = FVector(100.0f, 100.0f, 100.0f);
    };

    struct FNyxValue
    {
        enum class EKind { Null, Bool, Number, String, Object };

        EKind Kind = EKind::Null;
        bool BoolValue = false;
        double NumberValue = 0.0;
        std::string StringValue;
        std::unordered_map<std::string, FNyxValue> ObjectValue;

        FNyxValue() = default;
        FNyxValue(bool Value) : Kind(EKind::Bool), BoolValue(Value) {}
        FNyxValue(int Value) : Kind(EKind::Number), NumberValue(static_cast<double>(Value)) {}
        FNyxValue(float Value) : Kind(EKind::Number), NumberValue(static_cast<double>(Value)) {}
        FNyxValue(double Value) : Kind(EKind::Number), NumberValue(Value) {}
        FNyxValue(const char* Value) : Kind(EKind::String), StringValue(Value ? Value : "") {}
        FNyxValue(std::string Value) : Kind(EKind::String), StringValue(std::move(Value)) {}
        FNyxValue(std::unordered_map<std::string, FNyxValue> Value) : Kind(EKind::Object), ObjectValue(std::move(Value)) {}
    };

    using FNyxCommand = std::unordered_map<std::string, FNyxValue>;

    class UNyxRuntime;

    class UPrimitiveComponent
    {
    public:
        bool bSimulatePhysics = false;
        bool bEnableGravity = true;
        bool bCollisionEnabled = true;
        bool bMassless = false;
        float MassInKg = 1.0f;
        float LinearDamping = 0.01f;
        float AngularDamping = 0.0f;
        float Friction = 0.7f;
        float Restitution = 0.0f;
        FVector LinearVelocity;
        FVector AngularVelocity;
        FVector Force;
        FVector Impulse;
        std::string Material = "Default";
        std::string Shape = "Block";

        void SetSimulatePhysics(bool bValue) { bSimulatePhysics = bValue; }
        void SetEnableGravity(bool bValue) { bEnableGravity = bValue; }
        void SetMassOverrideInKg(float Mass, bool bOverrideMass = true)
        {
            if (bOverrideMass)
            {
                MassInKg = Mass;
            }
        }

        void AddForce(FVector InForce)
        {
            Force = Force + InForce;
        }

        void AddImpulse(FVector InImpulse)
        {
            Impulse = Impulse + InImpulse;
            const float SafeMass = std::max(MassInKg, 0.001f);
            LinearVelocity = LinearVelocity + InImpulse * (1.0f / SafeMass);
        }
    };

    class UStaticMeshComponent : public UPrimitiveComponent
    {
    public:
        UStaticMeshComponent()
        {
            Shape = "Block";
        }
    };

    class AActor
    {
    private:
        static int NextId;

    public:
        std::string NyxId;
        std::string Name = "Actor";
        FTransform Transform;
        UPrimitiveComponent* RootComponent = nullptr;
        FLinearColor Color = FLinearColor(0.64f, 0.64f, 0.65f);

        AActor()
        {
            NextId++;
            NyxId = "UnrealActor_" + std::to_string(NextId);
            RootComponent = new UStaticMeshComponent();
        }

        virtual ~AActor()
        {
            delete RootComponent;
        }

        FVector GetActorLocation() const { return Transform.Location; }
        FRotator GetActorRotation() const { return Transform.Rotation; }
        FVector GetActorScale3D() const { return Transform.Scale3D; }
        void SetActorLocation(FVector Location) { Transform.Location = Location; }
        void SetActorRotation(FRotator Rotation) { Transform.Rotation = Rotation; }
        void SetActorScale3D(FVector Scale3D) { Transform.Scale3D = Scale3D; }
    };

    int AActor::NextId = 0;

    class UNyxRuntime
    {
    public:
        static inline std::vector<FNyxCommand> Commands;
        static inline std::vector<std::string> Terminal;

        static FNyxValue Vec(const FVector& Value)
        {
            // { X, Y, Z }
            return FNyxValue({
                {"X", FNyxValue(Value.X)},
                {"Y", FNyxValue(Value.Z)},
                {"Z", FNyxValue(Value.Y)},
            });
        }

        static FNyxValue Colour(const FLinearColor& Value)
        {
            // { R, G, B }
            return FNyxValue({
                {"R", FNyxValue(Value.R)},
                {"G", FNyxValue(Value.G)},
                {"B", FNyxValue(Value.B)},
            });
        }

        static FNyxValue Frame(const FTransform& Transform)
        {
            // { X, Y, Z, RX, RY, RZ }
            return FNyxValue({
                {"X", FNyxValue(Transform.Location.X)},
                {"Y", FNyxValue(Transform.Location.Z)},
                {"Z", FNyxValue(Transform.Location.Y)},
                {"RX", FNyxValue(Transform.Rotation.Roll)},
                {"RY", FNyxValue(Transform.Rotation.Yaw)},
                {"RZ", FNyxValue(Transform.Rotation.Pitch)},
            });
        }

        static void EmitActor(const AActor& Actor)
        {
            UpsertCommand(ActorCommand(Actor));
        }

        static std::string CommandsToJson()
        {
            return CommandsToJson(Commands);
        }

        static std::string CommandsToJson(const std::vector<AActor*>& Actors)
        {
            std::vector<FNyxCommand> SceneCommands = Commands;
            for (const AActor* Actor : Actors)
            {
                if (!Actor)
                {
                    continue;
                }

                SceneCommands.erase(
                    std::remove_if(SceneCommands.begin(), SceneCommands.end(), [&](const FNyxCommand& Command)
                    {
                        const auto Cmd = Command.find("Cmd");
                        const auto Id = Command.find("Id");
                        return Cmd != Command.end() && Cmd->second.StringValue == "AddPart" &&
                               Id != Command.end() && Id->second.StringValue == Actor->NyxId;
                    }),
                    SceneCommands.end());
                SceneCommands.push_back(ActorCommand(*Actor));
            }
            return CommandsToJson(SceneCommands);
        }

    private:
        static FNyxCommand ActorCommand(const AActor& Actor)
        {
            const UPrimitiveComponent* Component = Actor.RootComponent;
            const bool bDynamic = Component && Component->bSimulatePhysics;
            const FVector Size = Actor.Transform.Scale3D;

            // { Cmd, Id, Name, Position, Size, Color, CFrame, Anchored, CanCollide, Transparency, Material, Shape, AssemblyLinearVelocity, AssemblyAngularVelocity, Force, Impulse, Massless, Mass, Density, Friction, Elasticity }
            return {
                {"Cmd", FNyxValue("AddPart")},
                {"Id", FNyxValue(Actor.NyxId)},
                {"Name", FNyxValue(Actor.Name)},
                {"Position", Vec(Actor.Transform.Location)},
                {"Size", Vec(Size)},
                {"Color", Colour(Actor.Color)},
                {"CFrame", Frame(Actor.Transform)},
                {"Anchored", FNyxValue(!bDynamic)},
                {"CanCollide", FNyxValue(Component ? Component->bCollisionEnabled : true)},
                {"Transparency", FNyxValue(0.0f)},
                {"Material", FNyxValue(Component ? Component->Material : "Default")},
                {"Shape", FNyxValue(Component ? Component->Shape : "Block")},
                {"AssemblyLinearVelocity", Vec(Component ? Component->LinearVelocity : FVector())},
                {"Velocity", Vec(Component ? Component->LinearVelocity : FVector())},
                {"AssemblyAngularVelocity", Vec(Component ? Component->AngularVelocity : FVector())},
                {"RotVelocity", Vec(Component ? Component->AngularVelocity : FVector())},
                {"Force", Vec(Component ? Component->Force : FVector())},
                {"Impulse", Vec(Component ? Component->Impulse : FVector())},
                {"Massless", FNyxValue(Component ? Component->bMassless : false)},
                {"Mass", FNyxValue(Component ? Component->MassInKg : 0.0f)},
                {"Density", FNyxValue(1.0f)},
                {"Friction", FNyxValue(Component ? Component->Friction : 0.7f)},
                {"Elasticity", FNyxValue(Component ? Component->Restitution : 0.0f)},
            };
        }

        static void UpsertCommand(FNyxCommand Command)
        {
            const auto Id = Command.find("Id");
            if (Id == Command.end())
            {
                Commands.push_back(std::move(Command));
                return;
            }

            for (FNyxCommand& Existing : Commands)
            {
                const auto ExistingCmd = Existing.find("Cmd");
                const auto ExistingId = Existing.find("Id");
                if (ExistingCmd != Existing.end() && ExistingCmd->second.StringValue == "AddPart" &&
                    ExistingId != Existing.end() && ExistingId->second.StringValue == Id->second.StringValue)
                {
                    Existing = std::move(Command);
                    return;
                }
            }

            Commands.push_back(std::move(Command));
        }

    public:
        static void SetCamera(FVector Position, FVector LookAt)
        {
            // { Cmd, Position, LookAt }
            Commands.push_back({
                {"Cmd", FNyxValue("SetCamera")},
                {"Position", Vec(Position)},
                {"LookAt", Vec(LookAt)},
            });
        }

        static void AddDirectionalLight(FVector Position, FLinearColor Color, float Intensity = 1.0f)
        {
            // { Cmd, LightType, Position, Color, Intensity }
            Commands.push_back({
                {"Cmd", FNyxValue("AddLight")},
                {"LightType", FNyxValue("Directional")},
                {"Position", Vec(Position)},
                {"Color", Colour(Color)},
                {"Intensity", FNyxValue(Intensity)},
            });
        }

        static std::string ToJson(const FNyxValue& Value)
        {
            switch (Value.Kind)
            {
                case FNyxValue::EKind::Null:
                    return "null";
                case FNyxValue::EKind::Bool:
                    return Value.BoolValue ? "true" : "false";
                case FNyxValue::EKind::Number:
                {
                    std::ostringstream Stream;
                    Stream << std::setprecision(8) << Value.NumberValue;
                    return Stream.str();
                }
                case FNyxValue::EKind::String:
                    return Quote(Value.StringValue);
                case FNyxValue::EKind::Object:
                {
                    std::vector<std::string> Parts;
                    for (const auto& Pair : Value.ObjectValue)
                    {
                        Parts.push_back(Quote(Pair.first) + ":" + ToJson(Pair.second));
                    }
                    return "{" + Join(Parts) + "}";
                }
            }
            return "null";
        }

        static std::string CommandsToJson(const std::vector<FNyxCommand>& SourceCommands)
        {
            std::vector<std::string> Parts;
            for (const FNyxCommand& Command : SourceCommands)
            {
                Parts.push_back(ToJson(FNyxValue(Command)));
            }
            return "[" + Join(Parts) + "]";
        }

        static std::string Quote(const std::string& Value)
        {
            std::string Out = "\"";
            for (char Ch : Value)
            {
                if (Ch == '\\' || Ch == '"')
                {
                    Out.push_back('\\');
                }
                Out.push_back(Ch);
            }
            Out.push_back('"');
            return Out;
        }

        static std::string Join(const std::vector<std::string>& Parts)
        {
            std::string Out;
            for (size_t Index = 0; Index < Parts.size(); ++Index)
            {
                if (Index > 0)
                {
                    Out += ",";
                }
                Out += Parts[Index];
            }
            return Out;
        }
    };

    inline void UE_LOG(const std::string& Message)
    {
        UNyxRuntime::Terminal.push_back(Message);
    }

    class UWorld
    {
    public:
        FVector Gravity = FVector(0.0f, 0.0f, -980.0f);
        std::vector<AActor*> Actors;

        template <typename TActor = AActor>
        TActor* SpawnActor(std::string Name = "Actor")
        {
            TActor* Actor = new TActor();
            Actor->Name = std::move(Name);
            Actors.push_back(Actor);
            UNyxRuntime::EmitActor(*Actor);
            return Actor;
        }

        void SetGravityZ(float GravityZ)
        {
            Gravity = FVector(0.0f, 0.0f, GravityZ);
            // { Cmd, Value }
            UNyxRuntime::Commands.push_back({
                {"Cmd", FNyxValue("SetGravity")},
                {"Value", FNyxValue(std::abs(GravityZ))},
            });
        }

        std::string CommandsToJson() const
        {
            return UNyxRuntime::CommandsToJson(Actors);
        }
    };
}
