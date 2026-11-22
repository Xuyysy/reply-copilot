// Static experimental examples. External pairs are locally selected, not generated; original examples are synthetic.
// Keep provenance out of prompts and never send upstream IDs or source metadata.
export const REPLY_V5_EXAMPLES = [
  {
    "id": "original-1",
    "language": "zh",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "加班",
      "需求",
      "上线"
    ],
    "post": "下班前五分钟才说这个需求今天要上线",
    "replies": [
      "这时间点选得挺讲究",
      "五分钟是留给你关电脑的吧",
      "要是今天必须上线，为什么现在才说"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-2",
    "language": "zh",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "会议",
      "开会",
      "汇报"
    ],
    "post": "开了两个小时的会，结论是下周再开一次",
    "replies": [
      "下周那个会有结论吗",
      "所以今天开的是预告片",
      "两个小时都没把下一步定下来"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-3",
    "language": "zh",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "bug",
      "代码",
      "报错",
      "程序",
      "环境变量"
    ],
    "post": "线上报错半天，最后发现是环境变量配错了",
    "replies": [
      "最不想看到的排查结果",
      "代码倒是一行没冤枉",
      "这种问题日志能直接指出配置就好了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-4",
    "language": "zh",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "ai",
      "模型",
      "代码",
      "工具"
    ],
    "post": "AI 写的代码能跑就行，为什么非要看懂每一行",
    "replies": [
      "出了问题总得知道去哪找吧",
      "能跑的定义包括下次还能改吗",
      "小脚本和长期维护的服务不是一回事"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-5",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "ai",
      "模型",
      "推理",
      "延迟",
      "速度"
    ],
    "post": "现在最烦的不是AI回答错，是等半天发现它答错了",
    "replies": [
      "两种时间都浪费了",
      "加载动画越长越有落差",
      "如果不确定能早点说就好"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-6",
    "language": "zh",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "项目",
      "上线",
      "发布",
      "功能"
    ],
    "post": "熬了一个星期，终于把第一个付费功能上线了",
    "replies": [
      "第一单应该会记很久",
      "先别急着看后台，今晚睡觉",
      "能收钱比本地跑通多了好多道坎"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-7",
    "language": "zh",
    "topic": "money",
    "scene": "question",
    "keywords": [
      "工资",
      "收入",
      "钱",
      "存款",
      "薪"
    ],
    "post": "月薪两万但每天工作十二小时，和一万五准点下班选哪个",
    "replies": [
      "先看看通勤多久",
      "下班以后那四个小时也值钱啊",
      "如果能学到东西，前者的期限也很重要"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-8",
    "language": "zh",
    "topic": "money",
    "scene": "observation",
    "keywords": [
      "消费",
      "价格",
      "买",
      "预算"
    ],
    "post": "买东西最难受的不是贵，是买完发现根本没用几次",
    "replies": [
      "还得找地方放它",
      "闲鱼见",
      "租来试几天也许比买便宜"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-9",
    "language": "zh",
    "topic": "money",
    "scene": "complaint",
    "keywords": [
      "订阅",
      "收费",
      "会员",
      "续费"
    ],
    "post": "每个月十几个软件订阅，已经不记得哪个在扣钱了",
    "replies": [
      "先把账单打开吧",
      "最稳定的是它们的收入",
      "年度订阅更容易忘"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-10",
    "language": "zh",
    "topic": "fitness",
    "scene": "complaint",
    "keywords": [
      "健身",
      "练腿",
      "深蹲",
      "训练"
    ],
    "post": "练完腿回家发现电梯坏了",
    "replies": [
      "今天是真走不动了",
      "楼梯突然变成第二个训练计划",
      "上楼还好说，下楼才费劲"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-11",
    "language": "zh",
    "topic": "fitness",
    "scene": "question",
    "keywords": [
      "健身",
      "训练",
      "减脂",
      "增肌",
      "体重"
    ],
    "post": "健身到底要不要每天记录体重",
    "replies": [
      "波动大的人每天看容易心态崩",
      "先别跟昨天那一斤较劲",
      "看七天趋势比盯单天数字有意思"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-12",
    "language": "zh",
    "topic": "fitness",
    "scene": "celebration",
    "keywords": [
      "跑步",
      "配速",
      "公里",
      "训练"
    ],
    "post": "终于第一次连续跑完五公里，中途没走路",
    "replies": [
      "可以啊，这个挺实在的",
      "下一次别急着卷配速",
      "连续跑完这关过了就好安排后面的训练了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-13",
    "language": "zh",
    "topic": "life",
    "scene": "complaint",
    "keywords": [
      "地铁",
      "通勤",
      "早起",
      "上班"
    ],
    "post": "早高峰挤上地铁才发现坐反了方向",
    "replies": [
      "这班算白挤了",
      "还好不是最后一站才发现",
      "回去那趟还得再挤一次"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-14",
    "language": "zh",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "奶茶",
      "咖啡",
      "外卖",
      "吃饭"
    ],
    "post": "外卖满减凑了十块钱，最后多花十五",
    "replies": [
      "本来只想吃个饭",
      "平台就喜欢这样的数学题",
      "下次直接按总价看省事"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-15",
    "language": "zh",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "周末",
      "休息",
      "睡觉",
      "假期"
    ],
    "post": "周日晚上永远比周一早上难熬",
    "replies": [
      "九点开始就不太对劲了",
      "明明还没上班",
      "周一的事要是能少一点，周日也能过好"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-16",
    "language": "zh",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "猫",
      "狗",
      "宠物",
      "小猫"
    ],
    "post": "给猫买了个两百块的窝，它睡快递箱",
    "replies": [
      "还好没把箱子扔了",
      "房子赠送一个包装盒",
      "可能箱子那个包围感它更喜欢"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-17",
    "language": "zh",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "发帖",
      "流量",
      "粉丝",
      "内容"
    ],
    "post": "发认真写的帖子没人看，随便发句吐槽却几万浏览",
    "replies": [
      "吐槽是发给谁看的，认真帖又是发给谁的",
      "算法先下班了",
      "可能不是质量问题，是进入话题的门槛不一样"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-18",
    "language": "zh",
    "topic": "creator",
    "scene": "celebration",
    "keywords": [
      "粉丝",
      "关注",
      "账号",
      "创作"
    ],
    "post": "账号终于破一千粉了",
    "replies": [
      "一千个真实的人，挺不容易的",
      "截图先存一下",
      "接下来看看哪些内容能把人留下来"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-19",
    "language": "zh",
    "topic": "study",
    "scene": "complaint",
    "keywords": [
      "论文",
      "导师",
      "实验",
      "研究"
    ],
    "post": "论文改到第六版，老师说第一版那个标题还不错",
    "replies": [
      "这句话多少有点杀伤力",
      "文件可以改名final_final了",
      "标题其实可以单独先确认下来"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-20",
    "language": "zh",
    "topic": "gaming",
    "scene": "humor",
    "keywords": [
      "游戏",
      "排位",
      "队友",
      "赛季"
    ],
    "post": "赢一把排位只要二十分钟，输一把之后能气一晚",
    "replies": [
      "下一把按钮有点危险",
      "晚上最好别点继续",
      "那一把的情绪都带进下一把了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-21",
    "language": "zh",
    "topic": "travel",
    "scene": "complaint",
    "keywords": [
      "旅行",
      "航班",
      "机场",
      "酒店"
    ],
    "post": "提前三个小时到机场，航班延误四小时",
    "replies": [
      "在机场过半天了",
      "早到的奖励是什么",
      "这种时候最烦的是不知道还要等多久"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-22",
    "language": "zh",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "做饭",
      "炒菜",
      "厨房",
      "菜"
    ],
    "post": "一个人做饭到底怎么买菜才不会剩一冰箱",
    "replies": [
      "买能冻的先",
      "青菜才是最难处理的",
      "先按两顿能吃完的量买可能简单点"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-23",
    "language": "en",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "meeting",
      "meetings",
      "calendar",
      "work"
    ],
    "post": "Spent an hour in a meeting to decide who should schedule the next meeting.",
    "replies": [
      "calendar's looking very productive",
      "could've been a calendar invite",
      "Who actually owns the decision now?"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-24",
    "language": "en",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "deadline",
      "boss",
      "work",
      "friday"
    ],
    "post": "My boss sent a 'quick question' at 5:59 on Friday.",
    "replies": [
      "the timing is immaculate",
      "nothing quick about that notification",
      "I'd want to know if it actually needs an answer today."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-25",
    "language": "en",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "bug",
      "debug",
      "code",
      "config"
    ],
    "post": "The bug was a missing environment variable. There goes my afternoon.",
    "replies": [
      "oh that one hurts",
      "the code was innocent the whole time",
      "A startup config check would've paid for itself here."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-26",
    "language": "en",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "ai",
      "llm",
      "model",
      "latency",
      "coding"
    ],
    "post": "AI coding tools are amazing until you have to find the one subtle bug they introduced.",
    "replies": [
      "the review is where it gets expensive",
      "suddenly the old docs look pretty good",
      "It's the confidence in the wrong bit that makes it harder to catch."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-27",
    "language": "en",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "ai",
      "model",
      "coding",
      "software"
    ],
    "post": "Do you still read every line of code your AI generates?",
    "replies": [
      "depends where the code is going",
      "more carefully when it touches billing",
      "A throwaway script and an auth endpoint deserve very different reviews."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-28",
    "language": "en",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "launch",
      "shipped",
      "release",
      "app"
    ],
    "post": "Finally shipped the feature I've been working on for two weeks.",
    "replies": [
      "nice, go close those tabs",
      "hope the deploy button gets a break",
      "The first bit of real feedback should be interesting."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-29",
    "language": "en",
    "topic": "money",
    "scene": "question",
    "keywords": [
      "salary",
      "money",
      "job",
      "pay"
    ],
    "post": "Would you take $20k more a year if it meant losing your weekends?",
    "replies": [
      "how many weekends are we talking",
      "the fine print is doing a lot of work here",
      "I'd want an end date on that arrangement."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-30",
    "language": "en",
    "topic": "money",
    "scene": "complaint",
    "keywords": [
      "subscription",
      "subscriptions",
      "price",
      "bills"
    ],
    "post": "Found three subscriptions I forgot I was paying for.",
    "replies": [
      "cancel button time",
      "the most loyal customer is an asleep one",
      "Annual renewals are especially easy to miss."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-31",
    "language": "en",
    "topic": "money",
    "scene": "observation",
    "keywords": [
      "buy",
      "bought",
      "spending",
      "shopping"
    ],
    "post": "Bought a fancy coffee machine and now I still get coffee on the way to work.",
    "replies": [
      "the counter looks great though",
      "convenience wins again",
      "The routine was probably the hard part to replace."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-32",
    "language": "en",
    "topic": "fitness",
    "scene": "complaint",
    "keywords": [
      "gym",
      "leg",
      "squats",
      "workout"
    ],
    "post": "Leg day was yesterday and my apartment has no elevator.",
    "replies": [
      "good luck getting back up",
      "stairs are a second membership fee",
      "Going down is the part I'd worry about."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-33",
    "language": "en",
    "topic": "fitness",
    "scene": "celebration",
    "keywords": [
      "run",
      "running",
      "5k",
      "pace"
    ],
    "post": "Ran my first 5k without stopping today.",
    "replies": [
      "that's a good milestone",
      "don't let the watch talk you into a 10k tomorrow",
      "Now you've got a distance you know you can finish."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-34",
    "language": "en",
    "topic": "fitness",
    "scene": "question",
    "keywords": [
      "gym",
      "fitness",
      "training",
      "weight"
    ],
    "post": "Is it worth tracking every workout if I'm not competing?",
    "replies": [
      "only if it helps you remember what to do next",
      "no need to turn it into accounting",
      "A rough record of weights and reps can be enough."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-35",
    "language": "en",
    "topic": "life",
    "scene": "complaint",
    "keywords": [
      "commute",
      "train",
      "bus",
      "traffic"
    ],
    "post": "Missed my train by about three seconds.",
    "replies": [
      "the worst possible margin",
      "that little door beep is brutal",
      "Some stations just don't leave enough time to transfer."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-36",
    "language": "en",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "weekend",
      "sunday",
      "monday",
      "sleep"
    ],
    "post": "Sunday evening feels shorter than every other evening.",
    "replies": [
      "starts disappearing around 4",
      "Monday gets there first somehow",
      "It's hard to switch off when you're planning tomorrow."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-37",
    "language": "en",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "cat",
      "pet",
      "box",
      "dog"
    ],
    "post": "My cat has chosen the box over the very expensive bed.",
    "replies": [
      "keep the receipt",
      "at least the box was included",
      "The enclosed sides might be what it likes."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-38",
    "language": "en",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "cook",
      "cooking",
      "meal",
      "food"
    ],
    "post": "How do people cook for one without eating the same thing for five days?",
    "replies": [
      "freezer bags",
      "the fifth bowl of chili is where it gets personal",
      "Cook a base you can use in a couple of different meals."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-39",
    "language": "en",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "posts",
      "post",
      "views",
      "followers"
    ],
    "post": "Spent days on an article that got 50 views. A random joke got 30k.",
    "replies": [
      "the internet has its own schedule",
      "at least you know which one people could finish",
      "The joke probably asked less of a stranger scrolling by."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-40",
    "language": "en",
    "topic": "creator",
    "scene": "celebration",
    "keywords": [
      "followers",
      "newsletter",
      "readers",
      "subscribers"
    ],
    "post": "Hit 1,000 newsletter subscribers this morning.",
    "replies": [
      "that's a lot of inboxes",
      "save that screenshot",
      "I'd be curious how many came through word of mouth."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-41",
    "language": "en",
    "topic": "study",
    "scene": "complaint",
    "keywords": [
      "paper",
      "thesis",
      "advisor",
      "research"
    ],
    "post": "My advisor's latest edit is to change the title back to the original one.",
    "replies": [
      "that file history has seen things",
      "version one quietly won",
      "Might be worth settling the title separately from the rest."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-42",
    "language": "en",
    "topic": "gaming",
    "scene": "humor",
    "keywords": [
      "game",
      "ranked",
      "match",
      "gaming"
    ],
    "post": "Won one ranked game, lost two, and somehow it's midnight.",
    "replies": [
      "the exit button is right there",
      "one more is a dangerous phrase",
      "The second loss probably wasn't the best time to queue again."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-43",
    "language": "en",
    "topic": "travel",
    "scene": "complaint",
    "keywords": [
      "flight",
      "airport",
      "travel",
      "delay"
    ],
    "post": "Got to the airport three hours early and the flight is four hours delayed.",
    "replies": [
      "that's a full shift at the airport",
      "the gate is your office now",
      "The uncertainty is worse than having a definite departure time."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-44",
    "language": "ja",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "バグ",
      "コード",
      "エラー",
      "修正"
    ],
    "post": "3時間バグと格闘した結果、変数名の打ち間違いだった",
    "replies": [
      "一番見つけにくいやつ",
      "3時間分の経験値は入ったと思いたい",
      "エラーがもう少し親切ならなあ"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-45",
    "language": "ja",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "会議",
      "仕事",
      "残業"
    ],
    "post": "会議が長引いた結果、次の会議の日程だけ決まった",
    "replies": [
      "今日はそれだけ？",
      "会議のための会議だ",
      "決める人がいなかったのかな"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-46",
    "language": "ja",
    "topic": "fitness",
    "scene": "complaint",
    "keywords": [
      "筋トレ",
      "脚",
      "ジム",
      "階段"
    ],
    "post": "脚トレの翌日にエレベーター点検はきつい",
    "replies": [
      "下りがきつそう",
      "もう一種目追加された",
      "今日は無理せずゆっくりで"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-47",
    "language": "ja",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "猫",
      "段ボール",
      "ベッド"
    ],
    "post": "猫用ベッド買ったのに段ボールで寝てる",
    "replies": [
      "箱捨てられないね",
      "本体より梱包材が人気",
      "狭くて落ち着くのかも"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-48",
    "language": "ja",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "料理",
      "自炊",
      "食材",
      "ご飯"
    ],
    "post": "一人暮らしで野菜使い切るの難しくない？",
    "replies": [
      "葉物が特に難しい",
      "冷凍庫が頼もしい",
      "少量で売ってくれると助かるんだけどね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-49",
    "language": "ko",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "버그",
      "코드",
      "오류",
      "개발"
    ],
    "post": "버그 잡느라 세 시간 썼는데 알고 보니 오타였다",
    "replies": [
      "이런 게 제일 안 보임",
      "코드는 억울하겠네",
      "오류 메시지에 위치라도 나왔으면"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-50",
    "language": "ko",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "회의",
      "퇴근",
      "야근",
      "일"
    ],
    "post": "한 시간 회의하고 다음 회의 날짜만 잡음",
    "replies": [
      "그래서 오늘 정한 건 날짜뿐인가요",
      "달력만 열일했네",
      "결정할 사람이 없었던 건가"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-51",
    "language": "ko",
    "topic": "fitness",
    "scene": "complaint",
    "keywords": [
      "헬스",
      "운동",
      "하체",
      "계단"
    ],
    "post": "하체 운동했는데 엘리베이터 점검 중",
    "replies": [
      "내려갈 때가 진짜 힘들겠다",
      "운동이 아직 안 끝났네요",
      "오늘은 좀 천천히 움직여야겠네"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-52",
    "language": "ko",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "고양이",
      "상자",
      "침대"
    ],
    "post": "고양이 침대 사 줬는데 택배 상자에서 잠",
    "replies": [
      "상자는 못 버리겠네요",
      "택배 상자가 본체였네",
      "옆이 막혀 있어서 좋은가 봐요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "original-53",
    "language": "ko",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "요리",
      "자취",
      "음식",
      "채소"
    ],
    "post": "혼자 사는데 채소 남기지 않고 먹는 방법 있나요",
    "replies": [
      "잎채소가 제일 어렵죠",
      "냉동실이 다 해결해 주더라고요",
      "두 끼 먹을 양만 사는 것부터 괜찮을 듯"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-19",
    "language": "zh",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "冰棍",
      "做饭",
      "自制"
    ],
    "post": "中午回去给你弄冰棍要不要啊",
    "replies": [
      "你自己会做？"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/19",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-29",
    "language": "zh",
    "topic": "life",
    "scene": "question",
    "keywords": [
      "眼睛",
      "眼角"
    ],
    "post": "你怎么变的眼睛大了，开眼角了？",
    "replies": [
      "？？？？？？？？我眼睛一直不小好吗"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/29",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-80",
    "language": "zh",
    "topic": "shopping",
    "scene": "observation",
    "keywords": [
      "护肤",
      "专柜",
      "试用"
    ],
    "post": "流金水我觉得好像我们这个年龄也不太适合，就是瓶子好看，哎，护肤上面真的要再做功课啊",
    "replies": [
      "要是有专柜就可以直接去试了上脸最直观"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/80",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-87",
    "language": "zh",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "搭配",
      "汤",
      "马蹄"
    ],
    "post": "这个搭配有什么奇怪啊？惊艳啥在广东是最常见的汤",
    "replies": [
      "是啦是啦，我是说马蹄啦！"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/87",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-112",
    "language": "zh",
    "topic": "life",
    "scene": "complaint",
    "keywords": [
      "方言",
      "闽南话",
      "听不懂"
    ],
    "post": "哈哈，理解我听不懂你们讲闽南话的痛苦了吧",
    "replies": [
      "太理解。哈哈"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/112",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-150",
    "language": "zh",
    "topic": "creator",
    "scene": "question",
    "keywords": [
      "广告",
      "取关",
      "关注"
    ],
    "post": "广告贴，果取关，什么意思啊？不懂",
    "replies": [
      "果断取消关注"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/150",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-184",
    "language": "zh",
    "topic": "relationships",
    "scene": "complaint",
    "keywords": [
      "吃饭",
      "随便",
      "女朋友"
    ],
    "post": "想认真的问一个很严肃的问题：女盆友吃饭说随便，我买了一份麻辣烫她怎么不吃说她困了？好生气！",
    "replies": [
      "你气啥？你女朋友都没生气呢。"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/184",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-237",
    "language": "zh",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "梦",
      "睁开眼",
      "丛林"
    ],
    "post": "睁开眼发现自己身处黝黑丛林",
    "replies": [
      "那是做梦了吧"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/237",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-249",
    "language": "zh",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "想家",
      "烧鹅"
    ],
    "post": "去那么大老远，想家是正常的~",
    "replies": [
      "我想吃烧鹅"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/249",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-123",
    "language": "zh",
    "topic": "life",
    "scene": "question",
    "keywords": [
      "小孩",
      "照相"
    ],
    "post": "大哥啊！才出生的小孩儿不能照相！",
    "replies": [
      "为什么啊、"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/123",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-114",
    "language": "en",
    "topic": "life",
    "scene": "question",
    "keywords": [
      "jar",
      "lid",
      "opening"
    ],
    "post": "if you are ever struggling with opening a jar... spoon. bonk top &/or side of lid with spoon. you are welcome.",
    "replies": [
      "tea towel over the jars lid presto done :P"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/114",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-234",
    "language": "en",
    "topic": "study",
    "scene": "question",
    "keywords": [
      "dorm",
      "room",
      "wall",
      "art"
    ],
    "post": "what masterpiece did you have a reprint up on your dorm room wall freshman year? I went with Guernica",
    "replies": [
      "What kind of mood did that set when you brought a fella back to your dorm lol"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/234",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-315",
    "language": "en",
    "topic": "money",
    "scene": "humor",
    "keywords": [
      "astrology",
      "chart",
      "money"
    ],
    "post": "for $10 you can send me your crush’s astrology chart & i’lol tell you if they are worth your time or not (:",
    "replies": [
      "how about you just show me how to read them and I Venmo you $13"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/315",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-599",
    "language": "en",
    "topic": "food",
    "scene": "humor",
    "keywords": [
      "soda",
      "pop",
      "drink"
    ],
    "post": "if you call pop “soda” I do not trust you",
    "replies": [
      "You must hate Michigan then huh"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/599",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-1073",
    "language": "en",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "camera",
      "video",
      "technology"
    ],
    "post": "Incredible that I can have a better video camera in my pocket than one used for a TV ad in 1980. Sick man. Good sick though.",
    "replies": [
      "with that sort of technology you will be a YouTube sensation in no time."
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1073",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-1273",
    "language": "en",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "coffee",
      "hazelnut"
    ],
    "post": "Hazelnut coffee anyone?",
    "replies": [
      "Bleeeeeurrrgh!! No thanks..."
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1273",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-1555",
    "language": "en",
    "topic": "food",
    "scene": "complaint",
    "keywords": [
      "cookies",
      "baking",
      "recipe",
      "oven"
    ],
    "post": "Cookies are burning for no reason :/ Grrrr... IF IT SAYS 9-12 MINUTES AND THEY ARE BURNT AT 8 MINUTES THE RECIPE IS A LIAR!!!",
    "replies": [
      "What temperature does the recipe say to bake them at?"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1555",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  }
];
