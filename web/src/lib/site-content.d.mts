export type NavigationItem={id:string;labelZh:string;labelEn:string;href:string;visible:boolean;sortOrder:number};
export const DEFAULT_NAVIGATION:NavigationItem[];
export function safeSiteLink(value:unknown,kind:string):string;
export function safeSupportEmail(value:unknown):string;
export function safeInternalLink(value:unknown):string;
export function siteNavigation(content:Record<string,any>):NavigationItem[];
export function createSiteContentLoader(fetchContent:()=>Promise<any>):(refresh?:boolean)=>Promise<Record<string,any>>;
export function applySiteContent(document:Document,content:Record<string,any>,language:string):void;

export function safeCtaLink(value:unknown):string;
export function shouldHideAccountCta(accountState:string,override:unknown):boolean;
