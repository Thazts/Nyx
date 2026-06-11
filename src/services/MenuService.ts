type Handler = () => void;

const Registry = new Map<string, Handler>();

export const MenuService = {
    Register(Id: string, Fn: Handler): void {
        Registry.set(Id, Fn);
    },
    Execute(Id: string): void {
        Registry.get(Id)?.();
    },
};
