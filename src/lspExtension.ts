
export interface IServerPosition {
    readonly line: number;
    readonly character: number;
}

export interface IServerRange {
    readonly start: IServerPosition;
    readonly end: IServerPosition;
}

export interface IServerLocation {
    readonly uri: string;
    readonly range: IServerRange;
}

export interface SyntaxTreeParams {
    readonly uri: string;
    readonly range?: IServerRange;
}

export type SyntaxTreeResponse = string | {
    readonly content?: string;
};
