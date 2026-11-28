import type {Language} from "../../lib/language";
import ReferralInviteCard from "./ReferralInviteCard";
import {usePartnerMembership,PartnerMembershipContent} from "./PartnerMembershipCard";

// One authenticated membership read, one referral read; both start in parallel.
// Cash reporting and the recipient profile remain independently gated and lazy.
export default function ReferralAndPartnerCards({language,owner}:{language:Language;owner:string}){
 const result=usePartnerMembership(owner);
 const showRecruitment=result?.enabled===true&&result.recruitmentEligible===true&&result.policy===null;
 const hasPartner=result?.enabled===true&&!!result.policy;
 return <ReferralInviteCard language={language} showRecruitment={showRecruitment} applicationsEnabled={result?.applicationsEnabled===true} renderPartner={hasPartner?(invites)=><PartnerMembershipContent owner={owner} language={language} result={result} inviteRecords={invites}/>:undefined} showPartnerAdvice={hasPartner&&result.policy?.status==="active"}/>;
}
