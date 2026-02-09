declare module "react-native-nitro-http-server" {
  export class StaticServer {
    start(port: number, path: string, host?: string): Promise<void>;
    stop(): void;
  }
}
