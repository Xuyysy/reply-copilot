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
      "给个提前量也好啊，就剩五分钟了",
      "五分钟连部署日志都看不完吧"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "两小时下来连个负责人都没定吗",
      "这会开得跟预告片似的"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "临时脚本可能无所谓，接手维护的时候就不一样了",
      "能跑是一回事，出问题能不能定位又是一回事"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "最怕等了半天还得从头验证一遍",
      "进度条走完那一刻才知道白等了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "恭喜！第一个付费功能上线，值得开心一下",
      "熬了一周终于能看到真实用户怎么用了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "我选一万五，每天能多出四个小时",
      "要是两万那份只忙一两个月，我倒是会考虑"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "最烦的是还得给它腾个地方",
      "闲鱼又多一件几乎全新的东西"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "光是弄清楚哪笔是哪家的就够烦的",
      "特别是年付的，扣钱那天才想起来"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "腿练完了，楼梯还在等你",
      "下楼的时候估计更难受"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "厉害啊！第一次五公里全程没走，值得记一下",
      "能连续跑完的那一下应该挺开心的"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "本来只想吃个饭，怎么还做上数学题了",
      "越凑越贵也是绝了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "明明还有几个小时假期，心已经到周一了",
      "周日晚上能不能别过那么快"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "认真写的那篇说不定更值得被看见",
      "随手一句可能刚好戳中很多人了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "恭喜破千！从零积攒起来可不容易",
      "四位数了，值得截张图留念"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "第六版看到这句话真的会沉默",
      "第一版文件还留着吧哈哈"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "气归气，最怕又点开下一把",
      "那个想把分赢回来的念头太难忍了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "早到三个小时再延误四小时，半天搭进去了",
      "希望起飞时间别再往后改了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "青菜买当天的，肉分小袋冷冻会方便很多",
      "我会先按两顿的量买，吃完再补"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "an hour and not a single decision?",
      "that really could've been a calendar invite"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "5:59 is such a rough time to see that notification",
      "hope it really was a quick question"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "congrats!! two weeks of work finally out in the world",
      "hope you get a good night off now"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "I'd keep the weekends, personally",
      "maybe for a few months, but not indefinitely"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "annual renewals are the sneaky ones",
      "the worst part is working out what each charge is for"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "the morning coffee stop just hits differently",
      "maybe the machine is more of a weekend thing"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "first nonstop 5k! congrats",
      "bet crossing that finish felt pretty good"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "the box was the real purchase all along",
      "at least now you know what to get the cat next time"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "hope the article finds its people too",
      "the joke got people in the door, now if only they'd read the article"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "congrats on 1k! that's a lot of people choosing to hear from you",
      "four digits looks pretty good on that subscriber count"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "hope you still have version one saved",
      "the title really took the scenic route"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "the urge to win the points back is dangerous",
      "and that's how one more game turns into six"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "3時間かけてそこにたどり着くのはつらい",
      "変数名だったか…お疲れさまです"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "それだけで終わっちゃったのか…",
      "次はちゃんと何か決まるといいですね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "下りの方がきつそう",
      "脚トレ延長戦だ"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "세 시간 만에 오타 발견하면 진짜 허탈하죠",
      "코드가 아니라 변수명이 범인이었네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "한 시간 썼는데 날짜만 정해진 거네요",
      "다음 회의에서는 뭔가 결정되면 좋겠네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "내려갈 때가 더 힘들겠어요",
      "하체 운동 연장전이네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
      "잎채소는 조금씩 사고 나머지는 냉동해 두면 편할 것 같아요",
      "두 끼 정도 먹을 양만 사는 건 어때요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
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
    },
    "retrievalDisabled": "private_or_familiar_context"
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
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
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
    },
    "retrievalDisabled": "depends_on_missing_prior_context"
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
    },
    "retrievalDisabled": "generic_agreement"
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
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
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
    },
    "retrievalDisabled": "depends_on_missing_prior_context"
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
    },
    "retrievalDisabled": "unrelated_first_person_tangent"
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
    },
    "retrievalDisabled": "unsupported_claim_context"
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
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
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
    },
    "retrievalDisabled": "predictive_flattery"
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
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
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
  },
  {
    "id": "lccc-toy-train-271-turn-0",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "照片",
      "内存",
      "存储",
      "128g"
    ],
    "post": "哈哈跟我一样我把照片全存空间里了，我觉得下次得买128g了",
    "replies": [
      "对吧，照片太占内存了"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/271/turn/0",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "agreement_and_restatement"
  },
  {
    "id": "lccc-toy-train-291-turn-0",
    "language": "zh",
    "topic": "gaming",
    "scene": "complaint",
    "keywords": [
      "线下",
      "赛事",
      "比赛",
      "门店"
    ],
    "post": "这个线下比赛到底怎么回事，让我们去线下门店，门店工作人员却对赛事一无所知，真是醉了",
    "replies": [
      "你去过线下门店了吗？"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/291/turn/0",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "asks_for_already_given_detail"
  },
  {
    "id": "lccc-toy-train-573-turn-0",
    "language": "zh",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "天气",
      "长袖",
      "降温",
      "外套"
    ],
    "post": "我的妈呀居然穿长袖了呀！！我还热成狗",
    "replies": [
      "晚上长袖外面还要加外套"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/573/turn/0",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-574-turn-0",
    "language": "zh",
    "topic": "entertainment",
    "scene": "observation",
    "keywords": [
      "电影",
      "上映",
      "影片"
    ],
    "post": "926好像很多电影上映哇",
    "replies": [
      "是呀，新影片集中的放映期……"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/574/turn/0",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "restatement"
  },
  {
    "id": "lccc-toy-train-902-turn-0",
    "language": "zh",
    "topic": "gaming",
    "scene": "observation",
    "keywords": [
      "安卓",
      "游戏",
      "通关",
      "收费"
    ],
    "post": "安卓也要收费啊，我买了一次，通关卸了。出遗忘海岸又买了一次，通关卸了。出艾达的梦又买了一次，通关，不敢再卸了",
    "replies": [
      "后面两个好玩吗"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/902/turn/0",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-891-turn-0",
    "language": "zh",
    "topic": "shopping",
    "scene": "humor",
    "keywords": [
      "电视",
      "乐视",
      "薯片"
    ],
    "post": "加油吧。别让我们失望。家里好几台乐视电视呢，我可不想以后没电视看。对了，等你的车好了，我要买一台。",
    "replies": [
      "你家开录像厅的吗。还好几台乐视电视！你确定是电视而不是薯片？"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/891/turn/0",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
  },
  {
    "id": "lccc-toy-train-65-turn-5",
    "language": "zh",
    "topic": "money",
    "scene": "complaint",
    "keywords": [
      "扣钱",
      "自动续费",
      "订阅",
      "会员"
    ],
    "post": "我现在特别怕事偷偷的扣了我的钱",
    "replies": [
      "嗯嗯，对哈，这点没想到，系统自动续费"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/65/turn/5",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "unsupported_assumption"
  },
  {
    "id": "lccc-toy-train-141-turn-2",
    "language": "zh",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "加班",
      "夜班",
      "下班",
      "工作"
    ],
    "post": "我刚洗了个澡。昨晚加班了，今天还没去呢",
    "replies": [
      "我去！那你还用去么？都这个点了，去了直接是夜班啦"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/141/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-145-turn-2",
    "language": "zh",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "萝卜",
      "兔子",
      "胡萝卜"
    ],
    "post": "早上的白萝卜不好吃，晚上的胡萝卜好吃",
    "replies": [
      "原来兔子也会挑萝卜吃，才知道！"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/145/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "depends_on_missing_prior_context"
  },
  {
    "id": "lccc-toy-train-218-turn-3",
    "language": "zh",
    "topic": "money",
    "scene": "humor",
    "keywords": [
      "有钱",
      "赚钱",
      "爱钱",
      "工资"
    ],
    "post": "对吧，今天我爱钱，明天钱不爱我",
    "replies": [
      "哈哈哈哪有钱一直爱你的"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/218/turn/3",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-285-turn-1",
    "language": "zh",
    "topic": "life",
    "scene": "question",
    "keywords": [
      "公猫",
      "猫",
      "捡到",
      "养猫"
    ],
    "post": "我家那只是公猫怎么下崽今天回家的时候路边捡到的",
    "replies": [
      "你要养着么"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/285/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-404-turn-2",
    "language": "zh",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "狗狗",
      "宠物",
      "账号",
      "回复"
    ],
    "post": "嗯？？？我被狗狗回复了？？？喜极而泣",
    "replies": [
      "主人智商下线登错号儿了"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/404/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
  },
  {
    "id": "lccc-toy-train-459-turn-2",
    "language": "zh",
    "topic": "fitness",
    "scene": "humor",
    "keywords": [
      "运动",
      "健身",
      "不运动",
      "训练"
    ],
    "post": "决定不运动了这样就解决了问题",
    "replies": [
      "哈哈哈哈干得漂亮"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/459/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "generic_praise"
  },
  {
    "id": "lccc-toy-train-683-turn-7",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "流量",
      "通话",
      "套餐",
      "话费"
    ],
    "post": "十八块钱，2300兆流量，300分钟通话，基本也就够了",
    "replies": [
      "这么便宜"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/683/turn/7",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-776-turn-1",
    "language": "zh",
    "topic": "study",
    "scene": "complaint",
    "keywords": [
      "寒假",
      "元旦",
      "放假"
    ],
    "post": "凡是元旦放假回家的寒假放假必定晚",
    "replies": [
      "能回家就行〜"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/776/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "dismisses_frustration"
  },
  {
    "id": "lccc-toy-train-887-turn-4",
    "language": "zh",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "加班",
      "五一",
      "假期",
      "公司"
    ],
    "post": "啥公司五一还加班呢！一点都不人性",
    "replies": [
      "就是没得意思"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/887/turn/4",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "generic_agreement"
  },
  {
    "id": "lccc-toy-train-978-turn-1",
    "language": "zh",
    "topic": "shopping",
    "scene": "humor",
    "keywords": [
      "邮局",
      "箱子",
      "打包",
      "快递"
    ],
    "post": "我当时先买的东西，后来发现邮局小号箱子装不下，只能用中号的了",
    "replies": [
      "那应该再买点吃的塞满"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/978/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-212-turn-5",
    "language": "zh",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "柚子",
      "种子",
      "种植",
      "盆栽"
    ],
    "post": "吃柚子剩下的种子，不是故意买的",
    "replies": [
      "这也成？？？我也要种。"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/212/turn/5",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-343",
    "language": "en",
    "topic": "creator",
    "scene": "question",
    "keywords": [
      "twitter",
      "account",
      "followers",
      "following"
    ],
    "post": "What do consider to be a large twitter account?",
    "replies": [
      "How can one person keep up with all those people. I am nowhere near that and I am lost most of the time!!!"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/343",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 7.666666666666667,
      "annotation_confidence": 79
    },
    "retrievalDisabled": "answers_different_question"
  },
  {
    "id": "uo-record-1232",
    "language": "en",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "phone",
      "broken",
      "repair"
    ],
    "post": "How do I tell my mum my phone is broken",
    "replies": [
      "\"Mum, my phone is broken.\""
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1232",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 25,
      "annotation_confidence": 85
    }
  },
  {
    "id": "uo-record-2357",
    "language": "en",
    "topic": "work",
    "scene": "observation",
    "keywords": [
      "work",
      "quit",
      "job",
      "summer"
    ],
    "post": "Last day of work EVER tomorrow. And by \"work,\" I mean Best Buy, and by \"ever,\" I mean \"until the summer.\"",
    "replies": [
      "you quit? Or are they letting you go"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/2357",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 33.666666666666664,
      "annotation_confidence": 72.33333333333333
    },
    "retrievalDisabled": "asks_for_already_given_detail"
  },
  {
    "id": "uo-record-2397",
    "language": "en",
    "topic": "relationships",
    "scene": "humor",
    "keywords": [
      "ex",
      "ghost",
      "haunting"
    ],
    "post": "my ex's ghost is following me(not on twitter)",
    "replies": [
      "Good job she is your ex then as otherwise you would have a permanent haunting problemo!"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/2397",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 34.666666666666664,
      "annotation_confidence": 76.66666666666667
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
  },
  {
    "id": "uo-record-1500",
    "language": "en",
    "topic": "entertainment",
    "scene": "complaint",
    "keywords": [
      "guitar",
      "tune",
      "music"
    ],
    "post": "GUITAR NOT STAY IN TUNE SO NO WORK WAT DO",
    "replies": [
      "Take a walk, grab a latte, take guitar to be tuned... Return to work, be productive... ?????"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1500",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 35,
      "annotation_confidence": 62
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
  },
  {
    "id": "uo-record-1974",
    "language": "en",
    "topic": "entertainment",
    "scene": "observation",
    "keywords": [
      "film",
      "movie",
      "blockbuster"
    ],
    "post": "Straight B-L-O-C-K-B-YOU-S-T-E-R! That is what Rowdy Rathore is!! Next 100-crore film? All chances!",
    "replies": [
      "no way!!! if that is what you think you should definitely watch the original."
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1974",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 26.6,
      "annotation_confidence": 75.4
    },
    "retrievalDisabled": "dismissive_recommendation"
  },
  {
    "id": "uo-record-1137",
    "language": "en",
    "topic": "money",
    "scene": "complaint",
    "keywords": [
      "teachers",
      "students",
      "school",
      "classroom"
    ],
    "post": "The amount of money teachers have to spend out of their pocket, for things needed in their class rooms, is freaking nuts.",
    "replies": [
      "the amount of money that is wasted by students that teachers pay for is unbelivable."
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1137",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 29.333333333333332,
      "annotation_confidence": 97
    },
    "retrievalDisabled": "redirects_complaint_to_blame"
  },
  {
    "id": "uo-record-1450",
    "language": "en",
    "topic": "food",
    "scene": "complaint",
    "keywords": [
      "fork",
      "noodle",
      "spoon",
      "lunch"
    ],
    "post": "Forgot to bring a fork to work, it is so demoralising eating a pot noodle with a tea spoon pensive face",
    "replies": [
      "its demoralising eating pot noodle when ya sober"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1450",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate",
      "annotated_offensiveness": 23.333333333333332,
      "annotation_confidence": 84
    },
    "retrievalDisabled": "tone_or_assumed_familiarity"
  },
  {
    "id": "lccc-toy-train-108-turn-1",
    "language": "zh",
    "topic": "life",
    "scene": "support",
    "keywords": [
      "迟回复",
      "抱歉",
      "不好意思",
      "忙"
    ],
    "post": "下午好!不好意思!迟回复友!周末快乐O!",
    "replies": [
      "没关系的，大家都在忙"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/108/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-197-turn-1",
    "language": "zh",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "养猫",
      "宠物",
      "猫"
    ],
    "post": "别光看到可爱。养猫很累的。",
    "replies": [
      "知道呀养个娃嘛"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/197/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-283-turn-1",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "电脑",
      "设置",
      "手机"
    ],
    "post": "用电脑设置就可以啊。",
    "replies": [
      "哦哦我说我用手机整不了呢"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/283/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "unverified_first_person_experience"
  },
  {
    "id": "lccc-toy-train-306-turn-1",
    "language": "zh",
    "topic": "fitness",
    "scene": "question",
    "keywords": [
      "健身房",
      "训练",
      "练前",
      "下午茶"
    ],
    "post": "哈哈哈，我准备出门去健身房了，你吃东西了吗？这个点应该叫下午茶吧",
    "replies": [
      "我正准备难道你们去健身房之前都不吃吗"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/306/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "private_or_familiar_context"
  },
  {
    "id": "lccc-toy-train-320-turn-1",
    "language": "zh",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "茄子",
      "买菜",
      "蔬菜"
    ],
    "post": "后来才发现我买的都是茄子",
    "replies": [
      "茄子好吃么"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/320/turn/1",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "generic_question"
  },
  {
    "id": "lccc-toy-train-678-turn-2",
    "language": "zh",
    "topic": "life",
    "scene": "support",
    "keywords": [
      "暴雨",
      "上班",
      "下雨"
    ],
    "post": "估计失恋了....明天后天暴雨...划船上班...",
    "replies": [
      "那你要注意安全了"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/678/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-787-turn-2",
    "language": "zh",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "鸟类",
      "猫猫",
      "狗狗",
      "宠物"
    ],
    "post": "哈哈鸟类不好玩只能放在笼子里还是猫猫狗狗的好玩",
    "replies": [
      "好吧..我也比较喜欢猫猫狗狗.."
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/787/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "lccc-toy-train-824-turn-2",
    "language": "zh",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "睡觉",
      "数羊",
      "水饺"
    ],
    "post": "数着水饺赶紧睡觉吧！",
    "replies": [
      "我听歌呢，刚才已经数过羊了"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/824/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    },
    "retrievalDisabled": "unverified_first_person_experience"
  },
  {
    "id": "lccc-toy-train-535-turn-2",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "共享自行车",
      "蓄电",
      "骑行",
      "电动车"
    ],
    "post": "通过骑行蓄电（共享自行车）蓄电完成就是共享电动车",
    "replies": [
      "如果骑行蓄电给钱的话，这模式还是不错。"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "CDial-GPT toy_data",
      "blob": "aeee83e2be5ae94de6e5b32287834de1776adf66",
      "record": "train/535/turn/2",
      "permission": "owner_reported",
      "transform": "remove token separators",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "uo-record-1062",
    "language": "en",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "steak",
      "dinner",
      "family",
      "cook"
    ],
    "post": "Love when my family gets together and has \"steak dinners\" =]",
    "replies": [
      "Mmmm! Do you and the family cook those steak dinners together? Or go out to eat?"
    ],
    "source": {
      "kind": "external_conversation",
      "dataset": "unintended-offense-tweets",
      "blob": "4303b89c734c38549e25642c11003a188d872d11",
      "record": "csv-record/1062",
      "permission": "owner_reported",
      "transform": "strip handles/URLs, normalize whitespace and ampersand entity",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-1",
    "language": "zh",
    "topic": "work",
    "scene": "celebration",
    "keywords": [
      "offer",
      "录用",
      "面试",
      "入职"
    ],
    "post": "等了两个星期，终于收到心仪公司的 offer 了",
    "replies": [
      "恭喜啊！这两周总算没白等",
      "今晚可以不用反复刷新邮箱了",
      "能选到自己想去的地方挺不容易的"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-2",
    "language": "zh",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "毕业",
      "答辩",
      "论文",
      "通过"
    ],
    "post": "答辩过了，感觉压在心里半年的石头终于落地了",
    "replies": [
      "恭喜！今晚终于能睡个踏实觉了",
      "这下可以把论文文件夹先关上了",
      "那种一直挂着一件事的感觉终于结束了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-3",
    "language": "zh",
    "topic": "work",
    "scene": "support",
    "keywords": [
      "面试",
      "被拒",
      "求职",
      "失落"
    ],
    "post": "准备了好久的面试还是被拒了，有点难受",
    "replies": [
      "准备了那么久，收到这个结果肯定不好受",
      "真可惜，希望下一次碰到更合适的机会"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
  },
  {
    "id": "v52-original-4",
    "language": "zh",
    "topic": "creator",
    "scene": "support",
    "keywords": [
      "发帖",
      "创作",
      "原创",
      "没人看"
    ],
    "post": "连续写了半个月原创，感觉好像没人看到",
    "replies": [
      "认真写了半个月，没什么回应挺磨人的",
      "希望那几篇慢慢能被更多人看到"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
  },
  {
    "id": "v52-original-5",
    "language": "en",
    "topic": "work",
    "scene": "celebration",
    "keywords": [
      "offer",
      "interview",
      "hired",
      "job"
    ],
    "post": "After weeks of checking my inbox I finally got the offer!",
    "replies": [
      "ah congrats!! the wait is over",
      "your inbox can finally have a day off",
      "Especially good when it's a role you actually wanted."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-6",
    "language": "en",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "graduated",
      "graduation",
      "thesis",
      "defense"
    ],
    "post": "Passed my thesis defense today. Can't believe it's done.",
    "replies": [
      "congrats, hope you get a proper evening off",
      "that folder can finally close",
      "Must feel strange not having it hanging over you anymore."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-7",
    "language": "en",
    "topic": "work",
    "scene": "support",
    "keywords": [
      "interview",
      "rejected",
      "rejection",
      "job"
    ],
    "post": "Didn't get the job I'd spent weeks preparing for. Pretty gutted.",
    "replies": [
      "ah that sucks, especially after weeks of prep",
      "sorry it didn't work out. hope the next one goes better"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
  },
  {
    "id": "v52-original-8",
    "language": "en",
    "topic": "creator",
    "scene": "support",
    "keywords": [
      "writing",
      "posts",
      "readers",
      "newsletter"
    ],
    "post": "Been writing every week and sometimes it feels like nobody's reading.",
    "replies": [
      "hope those posts find the right readers eventually",
      "putting in the work every week with no response sounds pretty rough"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
  },
  {
    "id": "v52-original-9",
    "language": "ja",
    "topic": "work",
    "scene": "celebration",
    "keywords": [
      "内定",
      "面接",
      "就職"
    ],
    "post": "ずっと行きたかった会社から内定もらえた！",
    "replies": [
      "おめでとう！待った甲斐があったね",
      "今日はメールを何度も確認しなくていいね",
      "行きたいところに決まったのが何よりうれしいね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-10",
    "language": "ja",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "卒業",
      "論文",
      "発表"
    ],
    "post": "卒論の発表終わった、やっと気が抜けた",
    "replies": [
      "お疲れさま！今日はゆっくりできるね",
      "しばらく論文のファイル開かなくていいね",
      "ずっと気になってたことが終わるとほっとするよね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-11",
    "language": "ja",
    "topic": "work",
    "scene": "support",
    "keywords": [
      "面接",
      "不採用",
      "落ちた",
      "就活"
    ],
    "post": "第一志望の面接落ちた。結構へこんでる",
    "replies": [
      "第一志望だったんですね。それはへこみますよね",
      "準備お疲れさまでした。次はいいご縁があるといいですね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
  },
  {
    "id": "v52-original-12",
    "language": "ja",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "投稿",
      "反応",
      "フォロワー",
      "ブログ"
    ],
    "post": "時間かけた投稿より何気ない一言の方が伸びる",
    "replies": [
      "あるある、読まれるきっかけって難しいね",
      "気合い入れた方も読んでほしいよね",
      "一言の方が気軽に反応しやすいのかも"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-13",
    "language": "ko",
    "topic": "work",
    "scene": "celebration",
    "keywords": [
      "합격",
      "면접",
      "입사"
    ],
    "post": "가고 싶었던 회사 최종 합격했다!",
    "replies": [
      "축하해요! 기다린 보람이 있네요",
      "이제 메일 새로고침 안 해도 되겠네요",
      "원하던 곳이라 더 기쁘겠어요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-14",
    "language": "ko",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "논문",
      "발표",
      "졸업"
    ],
    "post": "드디어 논문 발표 끝났다. 마음이 좀 가벼워짐",
    "replies": [
      "고생 많았어요! 오늘은 푹 쉬어요",
      "이제 그 파일 잠깐 닫아도 되겠네요",
      "계속 마음에 걸리던 일이 끝나면 정말 후련하죠"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v52-original-15",
    "language": "ko",
    "topic": "work",
    "scene": "support",
    "keywords": [
      "면접",
      "탈락",
      "불합격",
      "취업"
    ],
    "post": "열심히 준비한 면접에서 떨어졌다. 좀 속상하네",
    "replies": [
      "많이 준비한 만큼 속상하시겠어요",
      "다음에는 더 잘 맞는 기회가 있으면 좋겠네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4"
  },
  {
    "id": "v52-original-16",
    "language": "ko",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "글쓰기",
      "게시물",
      "조회수",
      "팔로워"
    ],
    "post": "열심히 쓴 글보다 아무 생각 없이 올린 글이 조회수 잘 나옴",
    "replies": [
      "시간 들인 글도 좀 읽어줬으면 좋겠네요",
      "참 알다가도 모르겠어요",
      "짧은 글은 처음 보는 사람도 반응하기 편한가 봐요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v54-original-1",
    "language": "zh",
    "topic": "entertainment",
    "scene": "observation",
    "keywords": [
      "电影",
      "上映",
      "电影票",
      "影片"
    ],
    "post": "这个月想看的两部电影居然同一天上映",
    "replies": [
      "这下得排个先后顺序了",
      "能不能一天连着看两场哈哈"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v54-original-2",
    "language": "en",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "camera",
      "video",
      "lens"
    ],
    "post": "The video quality on this little camera is way better than I expected.",
    "replies": [
      "nice! curious what it does in low light",
      "wild how much you can get out of a camera that small now"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v54-original-3",
    "language": "zh",
    "topic": "work",
    "scene": "complaint",
    "keywords": [
      "加班",
      "五一",
      "假期",
      "放假"
    ],
    "post": "别人都在准备五一出去玩，我还在等公司通知要不要加班",
    "replies": [
      "假期都快到了还不通知，最烦这种",
      "希望最后能正常放假，哪怕早点说也好"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    }
  },
  {
    "id": "v54-curated-zh-1",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "agent",
      "智能体",
      "上下文"
    ],
    "post": "Agent 跑了半天最后卡在一个弹窗上",
    "replies": [
      "有时候最难的不是推理，是那个确定按钮",
      "能自动做完九成，最后一成还是挺考验耐心的"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-2",
    "language": "zh",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "开源",
      "许可证",
      "维护者"
    ],
    "post": "小工具开源以后还要负责维护吗？",
    "replies": [
      "不一定，README 里提前说清楚维护范围就好",
      "愿意分享代码不代表要承诺长期客服"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-3",
    "language": "zh",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "首个用户",
      "注册用户",
      "独立开发"
    ],
    "post": "今天有一个完全不认识的人注册了我的小工具",
    "replies": [
      "陌生人的第一个注册真的挺有意义，恭喜啊",
      "不是朋友帮忙捧场，这次是真有人需要它"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-4",
    "language": "zh",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "依赖",
      "版本冲突",
      "依赖包"
    ],
    "post": "装一个依赖包，顺便把其他三个依赖搞挂了",
    "replies": [
      "这下又要开始考古版本号了",
      "最烦的是本来那个功能已经能用了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-5",
    "language": "zh",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "本地模型",
      "显存",
      "量化"
    ],
    "post": "本地模型是选大一点的量化版还是小一点的原精度版",
    "replies": [
      "我会先拿自己常用的任务试一遍，跑得动不代表适合用",
      "显存刚好卡住的话，小一点的日常用着可能更舒服"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-6",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "文档",
      "readme",
      "使用说明"
    ],
    "post": "一个工具最有用的功能居然藏在文档最下面",
    "replies": [
      "这一页应该放到首页去啊",
      "好东西藏得太深了，不看完根本不知道"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-7",
    "language": "zh",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "接口",
      "限流",
      "429"
    ],
    "post": "接口调通以后发现限流比想象中低多了",
    "replies": [
      "通是通了，一认真用就不让用了",
      "看样子真正的难题是请求怎么排队"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-8",
    "language": "zh",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "键盘",
      "机械键盘",
      "轴体"
    ],
    "post": "换了静音轴之后才发现原来的键盘有多吵",
    "replies": [
      "晚上打字应该舒服多了",
      "有时候最先感受到升级的是旁边的人"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-9",
    "language": "zh",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "git",
      "提交记录",
      "commit"
    ],
    "post": "你们提交记录都是写得很规范还是随便写？",
    "replies": [
      "多人维护的仓库我会认真写，自己的小实验就随意一点",
      "至少得让下周的自己知道改过什么"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-10",
    "language": "zh",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "自动化",
      "脚本",
      "重复操作"
    ],
    "post": "终于写脚本把每天重复点的那几个按钮干掉了",
    "replies": [
      "每天能少点几下，过一阵就知道有多值了",
      "恭喜把自己从重复劳动里赎出来一点"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-11",
    "language": "zh",
    "topic": "creator",
    "scene": "question",
    "keywords": [
      "长文",
      "文章",
      "标题"
    ],
    "post": "长文发出去之前最纠结的居然是标题，大家也是吗？",
    "replies": [
      "标题要让别人知道为什么值得点进去，这一步还真挺费脑子",
      "我会先写个直白的，最后再看看有没有更好的"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-12",
    "language": "zh",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "评论区",
      "回复",
      "讨论"
    ],
    "post": "有时候评论区比原帖本身更有意思",
    "replies": [
      "尤其是有人补了原帖没说到的那一段",
      "看到不同经历的人接话才是最有趣的部分"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-13",
    "language": "zh",
    "topic": "creator",
    "scene": "celebration",
    "keywords": [
      "第一篇",
      "阅读量",
      "长文"
    ],
    "post": "第一篇长文居然有陌生人看完还认真留言了",
    "replies": [
      "这种留言比一个顺手的赞有意思多了",
      "恭喜，能让人看完还愿意花时间写回复不容易"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-14",
    "language": "zh",
    "topic": "creator",
    "scene": "support",
    "keywords": [
      "数据下滑",
      "阅读量",
      "低迷"
    ],
    "post": "最近帖子数据掉得厉害，有点不知道写什么了",
    "replies": [
      "发出去没人接话的时候真的会有点泄气",
      "希望能碰到一个自己还想继续聊的话题"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-15",
    "language": "zh",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "截图",
      "内容创作",
      "素材"
    ],
    "post": "有些想法没及时记下来，等要发帖的时候已经忘了",
    "replies": [
      "当时那点情绪过去了，回来就怎么写都不像",
      "最可惜的是只记得当时觉得特别有意思"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-16",
    "language": "zh",
    "topic": "work",
    "scene": "question",
    "keywords": [
      "远程办公",
      "工位",
      "办公室"
    ],
    "post": "远程办公和去办公室，你更喜欢哪种？",
    "replies": [
      "我会选能自己安排几天去公司的那种",
      "需要专心写东西的时候，少一点来回打断就很舒服"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-17",
    "language": "zh",
    "topic": "work",
    "scene": "observation",
    "keywords": [
      "下班",
      "消息通知",
      "工作群"
    ],
    "post": "把工作群设成免打扰以后，下班像真的下班了",
    "replies": [
      "终于不用每响一声就猜是不是公司的事",
      "只要不是值班，晚上的消息明早看也来得及"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-18",
    "language": "zh",
    "topic": "work",
    "scene": "celebration",
    "keywords": [
      "转正",
      "试用期",
      "同事"
    ],
    "post": "试用期过了，今天终于正式转正",
    "replies": [
      "恭喜啊！这段时间总算踏实下来了",
      "可以给自己好好吃一顿庆祝了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-19",
    "language": "zh",
    "topic": "work",
    "scene": "support",
    "keywords": [
      "辞职",
      "交接",
      "离职"
    ],
    "post": "在一家公司待了三年，今天最后一天，有点舍不得",
    "replies": [
      "三年肯定有不少习惯和熟悉的人，舍不得很正常",
      "希望下一站也能遇到聊得来的同事"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-20",
    "language": "zh",
    "topic": "study",
    "scene": "question",
    "keywords": [
      "记笔记",
      "复习",
      "教材"
    ],
    "post": "看书的时候一定要记笔记吗？",
    "replies": [
      "遇到以后想找回来的东西我会记，没必要每页都摘",
      "有时看完能用自己的话讲出来就够了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-21",
    "language": "zh",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "奖学金",
      "科研",
      "投稿录用"
    ],
    "post": "第一次投稿就收到录用通知了！",
    "replies": [
      "恭喜！第一次走完整个投稿流程就有结果了",
      "收到那封邮件的时候肯定忍不住多看几遍"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-22",
    "language": "zh",
    "topic": "study",
    "scene": "complaint",
    "keywords": [
      "实验数据",
      "样本",
      "重做"
    ],
    "post": "实验数据整理到最后发现有一组时间对不上",
    "replies": [
      "最难受的是其他数据都已经整理好了",
      "希望原始记录还在，能把那一组找回来"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-23",
    "language": "zh",
    "topic": "study",
    "scene": "observation",
    "keywords": [
      "图书馆",
      "座位",
      "自习"
    ],
    "post": "图书馆最喜欢的是靠窗又没有人的那一排",
    "replies": [
      "不用隔一会儿就给别人让路真的很舒服",
      "有时候能找到一个舒服的位置就更愿意待下去了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-24",
    "language": "zh",
    "topic": "money",
    "scene": "question",
    "keywords": [
      "记账",
      "固定支出",
      "账本"
    ],
    "post": "你们记账会详细分到每一杯饮料吗？",
    "replies": [
      "固定支出我会记细一点，小额消费按类记就行",
      "要是记账比花钱本身还累，可能很难长期做下去"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-25",
    "language": "zh",
    "topic": "money",
    "scene": "observation",
    "keywords": [
      "二手",
      "闲置",
      "转卖"
    ],
    "post": "第一次把闲置卖出去，居然比买东西还开心",
    "replies": [
      "钱回来了，东西也不用继续占地方",
      "尤其是买家真的用得上，那感觉还不错"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-26",
    "language": "zh",
    "topic": "money",
    "scene": "complaint",
    "keywords": [
      "退款",
      "客服",
      "退货"
    ],
    "post": "退款申请提交三天了，客服一直让我耐心等待",
    "replies": [
      "给个明确时间也好啊，一直等最烦了",
      "三天了还没有进度，难怪你着急"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-27",
    "language": "zh",
    "topic": "money",
    "scene": "question",
    "keywords": [
      "冲动消费",
      "购物车",
      "付款"
    ],
    "post": "大家遇到想买但不急着用的东西会直接付款吗？",
    "replies": [
      "我倾向先放购物车，过两天还想要再说",
      "如果暂时想不出用在哪儿，我就会先等等"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-28",
    "language": "zh",
    "topic": "fitness",
    "scene": "celebration",
    "keywords": [
      "引体向上",
      "自重",
      "单杠"
    ],
    "post": "终于做出了第一个标准引体向上",
    "replies": [
      "漂亮！第一个上去的瞬间肯定特别爽",
      "这一关过去以后才有东西可以继续练了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-29",
    "language": "zh",
    "topic": "fitness",
    "scene": "observation",
    "keywords": [
      "体能",
      "爬山",
      "有氧"
    ],
    "post": "以前爬两层就喘，现在走上五楼居然还好",
    "replies": [
      "这种生活里突然发现的进步最有意思",
      "不用特地测也能感受到体能变好了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-30",
    "language": "zh",
    "topic": "fitness",
    "scene": "question",
    "keywords": [
      "拉伸",
      "热身",
      "动作幅度"
    ],
    "post": "你们训练前热身多久合适？",
    "replies": [
      "看当天练什么吧，正式动作前先做几组轻重量也挺实用",
      "我更在意动作有没有活动开，不太看分钟数"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-31",
    "language": "zh",
    "topic": "fitness",
    "scene": "complaint",
    "keywords": [
      "握力",
      "硬拉",
      "前臂"
    ],
    "post": "硬拉还没拉累，手先没劲了",
    "replies": [
      "背和腿明明还能继续，手先罢工了",
      "重量一上去才发现握力是另一回事"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-32",
    "language": "zh",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "面包",
      "烘焙",
      "烤箱"
    ],
    "post": "面包刚出炉的时候太香了，根本等不及凉下来",
    "replies": [
      "最难的步骤竟然是等它凉",
      "切开的时候还热乎乎的，想想就香"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-33",
    "language": "zh",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "早餐",
      "三明治",
      "早饭"
    ],
    "post": "通勤路上有什么方便带着吃的早餐？",
    "replies": [
      "三明治挺方便的，提前包好就能走",
      "饭团不容易掉得到处都是，路上也好拿"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-34",
    "language": "zh",
    "topic": "food",
    "scene": "humor",
    "keywords": [
      "火锅",
      "锅底",
      "蘸料"
    ],
    "post": "火锅还没开始吃，光配蘸料就已经搞了十分钟",
    "replies": [
      "蘸料才是今天的正餐吧",
      "每次配着配着就成一碗小菜了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-35",
    "language": "zh",
    "topic": "food",
    "scene": "celebration",
    "keywords": [
      "蛋糕",
      "打发",
      "烘焙"
    ],
    "post": "第一次自己做的蛋糕居然没塌！",
    "replies": [
      "恭喜！从烤箱里拿出来那刻应该很开心",
      "下一步是不是可以开始挑好看的盘子了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-36",
    "language": "zh",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "散步",
      "傍晚",
      "路灯"
    ],
    "post": "吃完饭沿着河边走了半小时，手机都没怎么看",
    "replies": [
      "傍晚这种不用赶时间的散步挺舒服的",
      "偶尔不带着任务出门也很好"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-37",
    "language": "zh",
    "topic": "life",
    "scene": "question",
    "keywords": [
      "合租",
      "室友",
      "公共空间"
    ],
    "post": "合租的公共区域怎么分摊打扫比较好？",
    "replies": [
      "固定轮流负责会比临时喊人公平一点",
      "最好先说清楚什么叫打扫完，不然容易各有标准"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-38",
    "language": "zh",
    "topic": "life",
    "scene": "celebration",
    "keywords": [
      "搬家",
      "新房间",
      "收拾"
    ],
    "post": "搬完家终于把自己的小房间布置好了",
    "replies": [
      "太好了，终于可以安心待在自己的空间里了",
      "最有成就感的可能是最后一个纸箱终于空了"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-39",
    "language": "zh",
    "topic": "life",
    "scene": "support",
    "keywords": [
      "疲惫",
      "没精神",
      "休息日"
    ],
    "post": "这周没发生什么大事但就是觉得很疲惫",
    "replies": [
      "有时候累就是累，不一定非要找出个原因",
      "希望这周末能有点真正不用忙的时间"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-40",
    "language": "zh",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "闹钟",
      "赖床",
      "贪睡"
    ],
    "post": "定了五个闹钟，最后被第六个意外来的电话叫醒",
    "replies": [
      "五个闹钟集体失业了",
      "电话那头可能还不知道自己救了你一早上"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-41",
    "language": "zh",
    "topic": "travel",
    "scene": "observation",
    "keywords": [
      "民宿",
      "窗外",
      "海边"
    ],
    "post": "住的民宿窗外正好能看到海，早上醒来就不想出门了",
    "replies": [
      "那不出门也算旅行的一部分啊",
      "这种窗景值得多赖一会儿床"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-42",
    "language": "zh",
    "topic": "travel",
    "scene": "question",
    "keywords": [
      "行李箱",
      "打包",
      "短途"
    ],
    "post": "两天一夜的短途旅行真的需要带行李箱吗？",
    "replies": [
      "一个双肩包基本够了，除非有要带回来的东西",
      "少带一点上车下车都轻松"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-43",
    "language": "zh",
    "topic": "entertainment",
    "scene": "observation",
    "keywords": [
      "演唱会",
      "现场",
      "返场"
    ],
    "post": "演唱会最后一首歌结束以后，全场都没急着走",
    "replies": [
      "那几分钟应该挺舍不得的",
      "灯都亮了还想再听一首的感觉"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-44",
    "language": "zh",
    "topic": "gaming",
    "scene": "question",
    "keywords": [
      "单机",
      "剧情",
      "游戏时长"
    ],
    "post": "一款单机游戏剧情好但操作一般，你会玩完吗？",
    "replies": [
      "剧情够吸引我就会，操作只要没折磨到玩不下去",
      "能让我想知道下一段故事发生什么就行"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-zh-45",
    "language": "zh",
    "topic": "shopping",
    "scene": "complaint",
    "keywords": [
      "快递柜",
      "包裹",
      "取件码"
    ],
    "post": "到了快递柜才发现有三个包裹被放到了三个地方",
    "replies": [
      "取个快递变成散步路线规划了",
      "最想早点回家的时候碰上这个真烦"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-1",
    "language": "en",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "agent",
      "browser automation",
      "popup"
    ],
    "post": "My agent did the hard part perfectly and then got stuck on a cookie banner.",
    "replies": [
      "the final boss was consent preferences",
      "Funny how much of automation comes down to the last button."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-2",
    "language": "en",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "open source",
      "maintainer",
      "license"
    ],
    "post": "If I open source a weekend project, am I signing up to maintain it forever?",
    "replies": [
      "nope, just be clear about what you intend to maintain",
      "sharing the code doesn't have to mean opening a support desk"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-3",
    "language": "en",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "first customer",
      "first user",
      "signup"
    ],
    "post": "My first signup from someone I don't know came in today.",
    "replies": [
      "ah congrats! a stranger actually needed the thing you built",
      "the first one that isn't a friend is a special one"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-4",
    "language": "en",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "dependency",
      "dependencies",
      "package lock"
    ],
    "post": "Updated one dependency, now somehow three other packages are broken.",
    "replies": [
      "the package lock file has entered the chat",
      "ugh, especially when the feature was already working"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-5",
    "language": "en",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "local model",
      "vram",
      "quantized"
    ],
    "post": "Bigger quantized model or a smaller full precision one for local use?",
    "replies": [
      "I'd compare them on the actual tasks you care about first",
      "The one that runs comfortably on your machine has a real advantage."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-6",
    "language": "en",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "readme",
      "documentation",
      "manual"
    ],
    "post": "The most useful feature in this tool was buried at the bottom of the README.",
    "replies": [
      "that deserves a spot right at the top",
      "glad you found it before giving up on the tool"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-7",
    "language": "en",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "rate limit",
      "429",
      "api quota"
    ],
    "post": "My API integration finally works and now I'm running into the rate limit.",
    "replies": [
      "the next challenge is keeping the requests in line",
      "getting it working only to be told to slow down is rough"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-8",
    "language": "en",
    "topic": "tech",
    "scene": "observation",
    "keywords": [
      "keyboard",
      "switches",
      "typing"
    ],
    "post": "Switched to quiet keyboard switches and didn't realize how loud my old ones were.",
    "replies": [
      "the people around you probably noticed too",
      "late night typing just got a lot nicer"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-9",
    "language": "en",
    "topic": "tech",
    "scene": "question",
    "keywords": [
      "git commit",
      "commit message",
      "commits"
    ],
    "post": "Do you take commit messages seriously on solo projects?",
    "replies": [
      "enough to help me remember what changed a week later",
      "I'd save the elaborate ones for changes with a surprising reason"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-10",
    "language": "en",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "automation",
      "script",
      "repetitive"
    ],
    "post": "Wrote a script that eliminates the same boring clicks I have to do every morning.",
    "replies": [
      "nicely done! that is going to add up over time",
      "pretty satisfying to remove something from your daily routine"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-11",
    "language": "en",
    "topic": "creator",
    "scene": "question",
    "keywords": [
      "headline",
      "essay title",
      "article title"
    ],
    "post": "Anyone else spend more time on the title than finishing the article?",
    "replies": [
      "the title has to make sense to someone who hasn't read any of it",
      "I'd start with the plain version and see if anything better comes up"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-12",
    "language": "en",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "comment section",
      "replies",
      "discussion"
    ],
    "post": "Sometimes the comment section ends up being better than the post.",
    "replies": [
      "especially when somebody adds a detail the author missed",
      "the best threads are the ones where different people bring something new"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-13",
    "language": "en",
    "topic": "creator",
    "scene": "celebration",
    "keywords": [
      "first essay",
      "published essay",
      "reader feedback"
    ],
    "post": "Someone I don't know read my first essay and left a really thoughtful comment.",
    "replies": [
      "congrats! that kind of comment is worth hanging onto",
      "they read it and then took the time to write something back. pretty cool"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-14",
    "language": "en",
    "topic": "creator",
    "scene": "support",
    "keywords": [
      "engagement dropped",
      "low engagement",
      "impressions"
    ],
    "post": "Engagement has been pretty low lately and I'm struggling to find things to write about.",
    "replies": [
      "that quiet stretch can be discouraging",
      "hope you find a topic you're excited to get back to"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-15",
    "language": "en",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "drafts",
      "idea notebook",
      "notes app"
    ],
    "post": "I always have a great post idea when I can't write it down.",
    "replies": [
      "and by the time you open the notes app it's gone",
      "half an idea in the notes is better than hoping to remember it"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-16",
    "language": "en",
    "topic": "work",
    "scene": "question",
    "keywords": [
      "remote work",
      "office days",
      "hybrid"
    ],
    "post": "Would you rather work remotely or go into the office every day?",
    "replies": [
      "I'd go for a bit of both if I could choose the days",
      "For tasks that need concentration, having fewer interruptions matters a lot."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-17",
    "language": "en",
    "topic": "work",
    "scene": "observation",
    "keywords": [
      "notifications",
      "work chat",
      "after hours"
    ],
    "post": "Muted my work chat after hours and suddenly my evenings feel like evenings again.",
    "replies": [
      "nice not having every buzz turn into a work thought",
      "Some messages really can wait until morning."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-18",
    "language": "en",
    "topic": "work",
    "scene": "celebration",
    "keywords": [
      "probation",
      "permanent role",
      "promotion"
    ],
    "post": "Passed my probation period today! Officially staying.",
    "replies": [
      "congrats!! must be a relief to have that settled",
      "hope you get to do something nice to celebrate"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-19",
    "language": "en",
    "topic": "work",
    "scene": "support",
    "keywords": [
      "last day",
      "leaving company",
      "coworkers"
    ],
    "post": "Last day at the company after three years. Feeling a bit sad about it.",
    "replies": [
      "three years is a lot of familiar faces to leave behind",
      "hope you keep in touch with the people you'll miss"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-20",
    "language": "en",
    "topic": "study",
    "scene": "question",
    "keywords": [
      "note taking",
      "textbook",
      "revision"
    ],
    "post": "Do you take notes on everything you read?",
    "replies": [
      "just the things I'd want to find again later",
      "Sometimes being able to explain it in your own words is enough."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-21",
    "language": "en",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "paper accepted",
      "conference acceptance",
      "research paper"
    ],
    "post": "My first paper got accepted!",
    "replies": [
      "congrats!! getting through that first submission is a big deal",
      "bet you reread that email a few times"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-22",
    "language": "en",
    "topic": "study",
    "scene": "complaint",
    "keywords": [
      "experiment data",
      "timestamps",
      "dataset"
    ],
    "post": "Almost finished cleaning my experiment data and found a batch with mismatched timestamps.",
    "replies": [
      "oh no, right at the end too",
      "hopefully the original records are still there to compare"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-23",
    "language": "en",
    "topic": "study",
    "scene": "observation",
    "keywords": [
      "library",
      "window seat",
      "studying"
    ],
    "post": "Found a really quiet window seat in the library and now I never want to study anywhere else.",
    "replies": [
      "a good seat makes a surprising difference",
      "hope nobody else discovers it too soon"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-24",
    "language": "en",
    "topic": "money",
    "scene": "question",
    "keywords": [
      "budgeting",
      "expense tracking",
      "budget app"
    ],
    "post": "Do you track tiny purchases individually when budgeting?",
    "replies": [
      "I'd group the small stuff and keep an eye on the recurring expenses",
      "the simpler it is to keep up with, the more useful it is"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-25",
    "language": "en",
    "topic": "money",
    "scene": "observation",
    "keywords": [
      "secondhand",
      "declutter",
      "resold"
    ],
    "post": "Sold something I never use and felt way happier than when I bought it.",
    "replies": [
      "getting the space back is half the fun",
      "nice when the buyer actually has a use for it too"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-26",
    "language": "en",
    "topic": "money",
    "scene": "complaint",
    "keywords": [
      "refund",
      "customer service",
      "return request"
    ],
    "post": "It's been three days and customer support keeps telling me my refund is being processed.",
    "replies": [
      "even a rough date would be better than endless waiting",
      "hope you get an actual update soon"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-27",
    "language": "en",
    "topic": "money",
    "scene": "question",
    "keywords": [
      "impulse purchase",
      "shopping cart",
      "checkout"
    ],
    "post": "Do you buy things you want immediately or leave them in the cart for a while?",
    "replies": [
      "I'd leave it there for a couple of days if I don't need it now",
      "Sometimes the urge disappears before you even get back to the cart."
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-28",
    "language": "en",
    "topic": "fitness",
    "scene": "celebration",
    "keywords": [
      "pull up",
      "pull-up",
      "chin-up"
    ],
    "post": "Finally managed my first unassisted pull-up!",
    "replies": [
      "let's go!! getting that first one feels huge",
      "congrats, one good rep to build on"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-29",
    "language": "en",
    "topic": "fitness",
    "scene": "observation",
    "keywords": [
      "stamina",
      "cardio",
      "staircase"
    ],
    "post": "Used to get winded on the stairs and today made it to the fifth floor without noticing.",
    "replies": [
      "that's such a satisfying way to notice progress",
      "the everyday stuff is where it really becomes apparent"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-30",
    "language": "en",
    "topic": "fitness",
    "scene": "question",
    "keywords": [
      "warmup",
      "warm-up",
      "mobility"
    ],
    "post": "How long do you usually warm up before lifting?",
    "replies": [
      "depends what I'm lifting, a few lighter sets first make sense",
      "I'd go by how ready the movement feels rather than a fixed timer"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-31",
    "language": "en",
    "topic": "fitness",
    "scene": "complaint",
    "keywords": [
      "grip strength",
      "deadlift",
      "forearms"
    ],
    "post": "My grip gives out on deadlifts before anything else feels tired.",
    "replies": [
      "annoying when the rest of you has more reps in it",
      "grip has a schedule of its own apparently"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-32",
    "language": "en",
    "topic": "food",
    "scene": "observation",
    "keywords": [
      "fresh bread",
      "baking bread",
      "sourdough"
    ],
    "post": "Just pulled a loaf out of the oven. Waiting for it to cool is the hardest part.",
    "replies": [
      "the smell makes waiting pretty unreasonable",
      "hope the first slice is worth it"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-33",
    "language": "en",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "portable breakfast",
      "sandwich",
      "breakfast commute"
    ],
    "post": "What breakfast can I take on a commute without making a huge mess?",
    "replies": [
      "a wrapped sandwich is a pretty easy option",
      "a rice ball is good if you want something you can hold in one hand"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-34",
    "language": "en",
    "topic": "food",
    "scene": "humor",
    "keywords": [
      "hot pot",
      "dipping sauce",
      "sauce bar"
    ],
    "post": "Spent ten minutes making my hot pot dipping sauce before eating anything.",
    "replies": [
      "you've basically made an appetizer",
      "half the meal is deciding what goes in that bowl"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-35",
    "language": "en",
    "topic": "food",
    "scene": "celebration",
    "keywords": [
      "cake baking",
      "first cake",
      "sponge cake"
    ],
    "post": "My first homemade cake didn't collapse!",
    "replies": [
      "congrats! that must have been a nice moment opening the oven",
      "now you get to do the fun part and decorate it"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-36",
    "language": "en",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "evening walk",
      "riverside",
      "sunset walk"
    ],
    "post": "Went for a walk by the river after dinner and barely looked at my phone.",
    "replies": [
      "sounds like a pretty good way to end the day",
      "nice when there's nowhere in particular you need to be"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-37",
    "language": "en",
    "topic": "life",
    "scene": "question",
    "keywords": [
      "roommates",
      "shared space",
      "chores"
    ],
    "post": "What's a fair way for roommates to split cleaning?",
    "replies": [
      "a simple rotation works if everyone agrees what needs doing",
      "I'd write down the common areas and divvy those up first"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-38",
    "language": "en",
    "topic": "life",
    "scene": "celebration",
    "keywords": [
      "new apartment",
      "unpacked",
      "moving day"
    ],
    "post": "Finally unpacked the last box at my new place.",
    "replies": [
      "congrats! it can actually feel like home now",
      "that last cardboard box deserves a little celebration"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-39",
    "language": "en",
    "topic": "life",
    "scene": "support",
    "keywords": [
      "worn out",
      "exhausted",
      "rest day"
    ],
    "post": "Nothing particularly bad happened this week but I feel completely worn out.",
    "replies": [
      "hope the weekend gives you a little room to just exist",
      "sometimes a week is tiring even without a big reason"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-40",
    "language": "en",
    "topic": "life",
    "scene": "humor",
    "keywords": [
      "alarm clock",
      "snooze",
      "overslept"
    ],
    "post": "Set five alarms and only woke up when somebody called me.",
    "replies": [
      "the five alarms have some explaining to do",
      "whoever called you accidentally saved the morning"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-41",
    "language": "en",
    "topic": "travel",
    "scene": "observation",
    "keywords": [
      "sea view",
      "seaside",
      "ocean view"
    ],
    "post": "Woke up to a sea view at this little guesthouse and don't really want to leave the room.",
    "replies": [
      "staying put sounds like a perfectly good holiday plan",
      "a slow breakfast with that view would be lovely"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-en-42",
    "language": "en",
    "topic": "entertainment",
    "scene": "observation",
    "keywords": [
      "encore",
      "concert",
      "live show"
    ],
    "post": "The lights came on after the last song and nobody seemed ready to leave.",
    "replies": [
      "that's a pretty nice sign of a good night",
      "there's something about the few minutes after a great set"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-1",
    "language": "ja",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "個人開発",
      "初ユーザー",
      "登録"
    ],
    "post": "個人開発したサービスに初めて知らない人が登録してくれた！",
    "replies": [
      "おめでとうございます！身内以外の最初の一人はうれしいですね",
      "ちゃんと必要としてくれる人に届いたんですね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-2",
    "language": "ja",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "依存関係",
      "ライブラリ",
      "アップデート"
    ],
    "post": "ライブラリ一つ更新したら依存関係が崩れた",
    "replies": [
      "元に戻すだけでも時間かかりそう…",
      "動いてたところまで巻き込まれるのがつらいですね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-3",
    "language": "ja",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "コメント欄",
      "返信",
      "感想"
    ],
    "post": "投稿よりコメント欄の方がおもしろいことがある",
    "replies": [
      "別の経験を持ってる人の話が聞けるのがいいですよね",
      "元の投稿になかった話が出てくるとつい読んじゃいます"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-4",
    "language": "ja",
    "topic": "work",
    "scene": "question",
    "keywords": [
      "在宅勤務",
      "出社",
      "リモート"
    ],
    "post": "在宅勤務と出社、どっちが好きですか？",
    "replies": [
      "曜日を自分で選べるなら両方あるのがいいかな",
      "集中したい日は家で作業できるとうれしいですね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-5",
    "language": "ja",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "採択",
      "学会",
      "研究"
    ],
    "post": "初めての投稿が採択された！",
    "replies": [
      "おめでとうございます！通知を見た瞬間うれしかったでしょうね",
      "初投稿でこの結果はうれしいですね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-6",
    "language": "ja",
    "topic": "fitness",
    "scene": "celebration",
    "keywords": [
      "懸垂",
      "自重",
      "鉄棒"
    ],
    "post": "初めて懸垂一回できた！",
    "replies": [
      "おめでとう！最初の一回はうれしいですね",
      "ここから少しずつ回数増やしていけそうですね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-7",
    "language": "ja",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "朝食",
      "サンドイッチ",
      "通勤中"
    ],
    "post": "通勤中に食べやすい朝食って何がありますか？",
    "replies": [
      "包んだサンドイッチなら持ち歩きやすいですね",
      "おにぎりも片手で食べられて便利ですよ"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-8",
    "language": "ja",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "散歩",
      "夕方",
      "川沿い"
    ],
    "post": "夕飯のあと川沿いを散歩した。スマホもほとんど見なかった",
    "replies": [
      "そういう時間いいですね",
      "急ぐ用事がない散歩って気持ちいいですよね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-9",
    "language": "ja",
    "topic": "life",
    "scene": "support",
    "keywords": [
      "疲れ",
      "気力",
      "休み"
    ],
    "post": "何かあったわけじゃないけど今週は妙に疲れた",
    "replies": [
      "週末少しゆっくりできるといいですね",
      "特別なことがなくても疲れる週ってありますよね"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ja-10",
    "language": "ja",
    "topic": "travel",
    "scene": "observation",
    "keywords": [
      "海",
      "窓",
      "宿"
    ],
    "post": "宿の窓から海が見えて、出かける気がなくなった",
    "replies": [
      "その景色なら部屋でのんびりするのもいいですね",
      "朝ごはんもゆっくり食べたくなりそう"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-1",
    "language": "ko",
    "topic": "tech",
    "scene": "celebration",
    "keywords": [
      "개인 개발",
      "첫 사용자",
      "가입"
    ],
    "post": "개인 개발한 서비스에 모르는 사람이 처음 가입했다!",
    "replies": [
      "축하해요! 지인 아닌 첫 사용자라 더 기쁘겠네요",
      "필요한 사람한테 드디어 닿았네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-2",
    "language": "ko",
    "topic": "tech",
    "scene": "complaint",
    "keywords": [
      "의존성",
      "라이브러리",
      "업데이트"
    ],
    "post": "라이브러리 하나 업데이트했더니 의존성이 다 꼬였다",
    "replies": [
      "잘 되던 것까지 건드려지는 게 제일 힘들죠",
      "원래 하던 작업은 언제 다시 하죠…"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-3",
    "language": "ko",
    "topic": "creator",
    "scene": "observation",
    "keywords": [
      "댓글",
      "대댓글",
      "게시글"
    ],
    "post": "가끔 원래 글보다 댓글이 더 재미있다",
    "replies": [
      "다른 경험 가진 사람들이 얘기 보태는 게 재밌어요",
      "글에는 없던 이야기가 나올 때가 있죠"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-4",
    "language": "ko",
    "topic": "work",
    "scene": "question",
    "keywords": [
      "재택근무",
      "출근",
      "사무실"
    ],
    "post": "재택근무랑 사무실 출근 중 뭐가 더 좋으세요?",
    "replies": [
      "요일을 고를 수 있으면 둘 다 있는 게 좋겠어요",
      "집에서 집중할 수 있는 날이 있으면 편하죠"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-5",
    "language": "ko",
    "topic": "study",
    "scene": "celebration",
    "keywords": [
      "논문 채택",
      "학회",
      "연구"
    ],
    "post": "처음 투고한 논문이 채택됐어요!",
    "replies": [
      "축하해요! 메일 보고 정말 기뻤겠네요",
      "첫 투고부터 좋은 소식이라니 좋네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-6",
    "language": "ko",
    "topic": "fitness",
    "scene": "celebration",
    "keywords": [
      "턱걸이",
      "풀업",
      "철봉"
    ],
    "post": "오늘 처음으로 턱걸이 한 개 성공했다!",
    "replies": [
      "축하해요! 첫 한 개가 정말 어렵죠",
      "이제 조금씩 늘려가는 재미가 있겠네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-7",
    "language": "ko",
    "topic": "food",
    "scene": "question",
    "keywords": [
      "아침 식사",
      "샌드위치",
      "통근"
    ],
    "post": "출근길에 먹기 편한 아침 식사 추천 있나요?",
    "replies": [
      "포장한 샌드위치가 들고 다니기 편해요",
      "주먹밥도 한 손으로 먹기 좋죠"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-8",
    "language": "ko",
    "topic": "life",
    "scene": "observation",
    "keywords": [
      "산책",
      "저녁",
      "강변"
    ],
    "post": "저녁 먹고 강변을 산책했다. 휴대폰도 거의 안 봄",
    "replies": [
      "그런 시간 참 좋죠",
      "딱히 급하게 갈 곳 없는 산책이 편하더라고요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-9",
    "language": "ko",
    "topic": "life",
    "scene": "support",
    "keywords": [
      "피곤",
      "지쳤",
      "휴식"
    ],
    "post": "별일 없었는데 이번 주는 유난히 피곤하네",
    "replies": [
      "주말에는 좀 편하게 쉴 수 있으면 좋겠어요",
      "특별한 일 없어도 유난히 지치는 주가 있죠"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  },
  {
    "id": "v54-curated-ko-10",
    "language": "ko",
    "topic": "travel",
    "scene": "observation",
    "keywords": [
      "바다 전망",
      "숙소",
      "오션뷰"
    ],
    "post": "숙소에서 바다가 보여서 밖에 나가기 싫어졌다",
    "replies": [
      "그냥 숙소에서 쉬는 것도 여행이죠",
      "그 풍경이면 아침부터 천천히 보내고 싶겠네요"
    ],
    "source": {
      "kind": "synthetic",
      "review": "editorial_candidate"
    },
    "editorialRevision": "v5.4-expanded"
  }
];
