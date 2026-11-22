// V5 experiment only: conservative deterministic preference of an already
// generated candidate. Do not edit text, remove a candidate, retry, or change
// recommendation/quote/score/schema. Not an AI detector or safety classifier.
import { REPLY_STYLES } from "../domain/reply-result.js";
const generic = [
 /^(?:so true|absolutely|great (?:point|insight|post)|love this|well said|couldn['’]?t agree more|this is so important|exactly)[!.。！\s]*$/iu,
 /^(?:太真实了|确实如此|说得太对了|非常认同|很有启发|值得深思|说得好|受教了|深有同感|太有道理了)[!！。\s]*$/u,
 /^(?:その通りです|素晴らしいですね|勉強になります)[。！!\s]*$/u,
 /^(?:정말 공감합니다|좋은 글이네요|맞는 말입니다)[.!。\s]*$/u,
];
const canned = [
 /(?:thanks for sharing (?:your|this)|thank you for sharing (?:your|this)|in today['’]s fast-paced world|a powerful reminder that|a testament to the power of|it['’]s not just about.{1,80}it['’]s about)/iu,
 /(?:感谢分享.{0,20}(?:见解|观点|感悟)|这也提醒我们|这正是.{1,30}的意义所在|每一次坚持.{0,30}(?:更好的自己|成就)|在这个快节奏的时代)/u,
];
// Count only clear, separated agreement prefaces. Do not flag a
// substantive sentence like "确实需要更多数据" or "Exactly two days".
const agreementOpening = /^(?:(?:确实|的确|没错|说得对|太真实了|确实如此)(?=[，,。！!：:\s]|$)|(?:exactly|absolutely|so true|agreed|well said)(?=[,.!:\s]*$|[,!.:]))/iu;
function hasAgreementOpening(text){
 return typeof text==="string"&&agreementOpening.test(text.trim().slice(0,1500));
}
export function replyV5TemplatePenalty(text){
 if(typeof text!=="string")return 0;
 const s=text.trim().slice(0,1500);
 return generic.some(re=>re.test(s))?3:canned.some(re=>re.test(s))?2:0;
}
export function rerankV5DefaultStyle(raw,env){
 if(env?.ENVIRONMENT!=="staging"||(env?.STAGING_REPLY_PROMPT_VERSION!==undefined && env?.STAGING_REPLY_PROMPT_VERSION!=="v5"))return raw;
 // Call only AFTER the shared model-output validator. Fail open without
 // affecting the normal response or charging for an additional generation.
 try {
  const parsed=JSON.parse(raw);
  if(parsed?.recommendation!=="reply"||!REPLY_STYLES.includes(parsed.defaultStyle))return raw;
  if(!REPLY_STYLES.every(s=>typeof parsed.replies?.[s]==="string"&&parsed.replies[s].trim()))return raw;
  const current=parsed.replies[parsed.defaultStyle];
  const penalty=replyV5TemplatePenalty(current);
  // A substantive reply with one natural agreement marker is not a defect.
  // Act only when the default and at least one other option share this
  // generic conversational move, and a clean non-humor alternative exists.
  const repeated=hasAgreementOpening(current)&&REPLY_STYLES.filter(s=>hasAgreementOpening(parsed.replies[s])).length>=2;
  if(penalty<2&&!repeated)return raw;
  const other=REPLY_STYLES.filter(s=>s!==parsed.defaultStyle&&s!=="light_humor").find(s=>replyV5TemplatePenalty(parsed.replies[s])===0&&(!repeated||!hasAgreementOpening(parsed.replies[s])));
  if(!other)return raw;
  // The shared wire serializer emits all three compatibility aliases.
  // Keep existing aliases synchronized without adding or removing fields.
  const next={...parsed,defaultStyle:other};
  for(const key of ["default_style","best_reply_style"])
    if(Object.hasOwn(next,key))next[key]=other;
  return JSON.stringify(next);
 } catch {return raw;}
}
