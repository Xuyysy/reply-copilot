import {useState} from "react";
import type {Language} from "../../lib/language";
import ReferralInviteCard from "./ReferralInviteCard";
import PartnerMembershipCard from "./PartnerMembershipCard";

// Share the existing authenticated membership request; no additional API
// calls, no duplicated membership state, and no recruiting approved partners.
export default function ReferralAndPartnerCards({language,owner}:{language:Language;owner:string}){
 const [showRecruitment,setShowRecruitment]=useState(false);
 return <>
  <ReferralInviteCard language={language} showRecruitment={showRecruitment}/>
  <PartnerMembershipCard owner={owner} language={language} onRecruitment={setShowRecruitment}/>
 </>;
}
