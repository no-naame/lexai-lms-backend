import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ─── Google sample video URLs (cycled across lessons) ────────────
const SAMPLE_VIDEOS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
];
let videoIndex = 0;
function nextVideo(): string {
  const url = SAMPLE_VIDEOS[videoIndex % SAMPLE_VIDEOS.length];
  videoIndex++;
  return url;
}

// ─── Unsplash thumbnail URLs ─────────────────────────────────────
const THUMBNAILS = [
  "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&q=80",
  "https://images.unsplash.com/photo-1712002641088-9d76f9080889?w=800&q=80",
  "https://images.unsplash.com/photo-1561736778-92e52a7769ef?w=800&q=80",
  "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&q=80",
  "https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=800&q=80",
  "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&q=80",
  "https://images.unsplash.com/photo-1515879218367-8466d910aede?w=800&q=80",
  "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&q=80",
  "https://images.unsplash.com/photo-1531746790095-6c10a4031e48?w=800&q=80",
  "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&q=80",
  "https://images.unsplash.com/photo-1535378917042-10a22c95931a?w=800&q=80",
];

// ─── Helper to seed modules & lessons for a course ───────────────
async function seedCourseContent(
  courseId: string,
  modules: Array<{
    title: string;
    description: string;
    order: number;
    lessons: Array<{
      title: string;
      order: number;
      type: "VIDEO" | "ARTICLE";
      isFree: boolean;
      isPreview?: boolean;
      duration: number; // seconds
    }>;
  }>
) {
  for (const mod of modules) {
    const createdModule = await prisma.module.create({
      data: {
        courseId,
        title: mod.title,
        description: mod.description,
        order: mod.order,
      },
    });

    for (const lesson of mod.lessons) {
      await prisma.lesson.create({
        data: {
          moduleId: createdModule.id,
          title: lesson.title,
          order: lesson.order,
          type: lesson.type,
          isFree: lesson.isFree,
          isPreview: lesson.isPreview ?? lesson.isFree,
          videoUrl: lesson.type === "VIDEO" ? nextVideo() : null,
          content: `# ${lesson.title}`,
          duration: lesson.duration,
        },
      });
    }
  }
}

// ─── Shorthand lesson builder ────────────────────────────────────
type LessonInput = {
  title: string;
  order: number;
  type: "VIDEO" | "ARTICLE";
  isFree: boolean;
  isPreview?: boolean;
  duration: number;
};

function lessons(
  items: Array<[string, "VIDEO" | "ARTICLE", number]>,
  firstFree = false
): LessonInput[] {
  return items.map(([title, type, durationMin], i) => ({
    title,
    order: i + 1,
    type,
    isFree: firstFree && i === 0,
    isPreview: firstFree && i === 0,
    duration: durationMin * 60, // convert minutes → seconds
  }));
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log("🗑️  Wiping all tables (FK-safe order)...");

  // Step 1: Delete all data in FK-safe order
  await prisma.userLessonProgress.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.module.deleteMany();
  await prisma.courseEnrollment.deleteMany();
  await prisma.batchCourseAccess.deleteMany();
  await prisma.organizationCourseAccess.deleteMany();
  await prisma.course.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.studentRecord.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.oAuthAccount.deleteMany();
  await prisma.videoAsset.deleteMany();
  await prisma.user.deleteMany();

  console.log("✅ All tables wiped");

  // ─── Step 2: Create users ──────────────────────────────────────
  console.log("👤 Creating users...");

  const [adminPw, instAdminPw, studentPw] = await Promise.all([
    bcrypt.hash("admin123456", 12),
    bcrypt.hash("instadmin123", 12),
    bcrypt.hash("student123", 12),
  ]);

  const admin = await prisma.user.create({
    data: {
      name: "Platform Admin",
      email: "admin@lexai.com",
      hashedPassword: adminPw,
      role: "PLATFORM_ADMIN",
      emailVerified: new Date(),
    },
  });

  const instAdmin = await prisma.user.create({
    data: {
      name: "Dr. Meera Krishnan",
      email: "admin@demo-university.edu",
      hashedPassword: instAdminPw,
      role: "INSTITUTION_ADMIN",
      emailVerified: new Date(),
    },
  });

  const student = await prisma.user.create({
    data: {
      name: "Arjun Mehta",
      email: "student@gmail.com",
      hashedPassword: studentPw,
      role: "STUDENT",
      emailVerified: new Date(),
      isPremium: true,
    },
  });

  console.log(`  Created: ${admin.email}, ${instAdmin.email}, ${student.email}`);

  // ─── Step 3: Organization + Batch + Student Records ────────────
  console.log("🏛️  Creating organization, batch, student records...");

  const org = await prisma.organization.create({
    data: {
      name: "Demo University",
      slug: "demo-university",
      emailDomains: ["demo-university.edu"],
      contractStart: new Date(),
      contractEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  const batch = await prisma.batch.create({
    data: {
      organizationId: org.id,
      name: "2025 Spring - AI Program",
    },
  });

  // Dr. Meera Krishnan as org ADMIN member
  await prisma.organizationMember.create({
    data: {
      userId: instAdmin.id,
      organizationId: org.id,
      role: "ADMIN",
      isVerified: true,
    },
  });

  // Student records
  const studentRecords = [
    { email: "priya.sharma@demo-university.edu", name: "Priya Sharma", enrollmentId: "STU-2025-001" },
    { email: "rohan.iyer@demo-university.edu", name: "Rohan Iyer", enrollmentId: "STU-2025-002" },
    { email: "ananya.gupta@demo-university.edu", name: "Ananya Gupta", enrollmentId: "STU-2025-003" },
  ];

  for (const rec of studentRecords) {
    await prisma.studentRecord.create({
      data: {
        organizationId: org.id,
        email: rec.email,
        name: rec.name,
        enrollmentId: rec.enrollmentId,
        batchId: batch.id,
      },
    });
  }

  console.log(`  Org: ${org.name} | Batch: ${batch.name} | ${studentRecords.length} student records`);

  // ─── Step 4: Create 11 courses ─────────────────────────────────
  console.log("📚 Creating 11 courses...");

  const courseDefs = [
    // ── Track 1: Engineering (7 courses) ──
    {
      title: "Foundations of Regression",
      slug: "foundations-of-regression",
      description: "Master linear and logistic regression from mathematical foundations to production deployment.",
      shortDescription: "Derive, train, evaluate, and deploy regression models from scratch.",
      longDescription: "Start from OLS derivation and gradient descent dynamics, advance through logistic classifiers and L1/L2 regularization, and finish by deploying a trained model as a REST API. Ideal for anyone serious about understanding the maths behind ML.",
      thumbnail: THUMBNAILS[0],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "engineering",
      level: "Beginner",
      tags: ["regression", "machine-learning", "gradient-descent", "python"],
      isFeatured: false,
      studentsCount: 1420,
      rating: 4.7,
      reviewsCount: 98,
      whatYouWillLearn: [
        "Derive linear regression from scratch",
        "Understand gradient descent dynamics",
        "Build logistic classifiers for binary and multiclass problems",
        "Apply L1/L2 regularization and cross-validation",
        "Evaluate models with MSE, R², precision, recall, and ROC-AUC",
        "Deploy a trained model as a Flask REST API",
      ],
      prerequisites: ["Basic Python programming", "High school algebra", "Jupyter notebooks helpful but not required"],
      includes: { videoHours: 8, articles: 10, resources: 6, exercises: 8, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-02-15"),
    },
    {
      title: "Mastering Deep Neural Networks",
      slug: "mastering-deep-neural-networks",
      description: "From perceptrons to production-grade deep networks — backpropagation, optimizers, and regularization demystified.",
      shortDescription: "Backprop, optimizers, regularization — deep nets demystified.",
      longDescription: "Build a perceptron from scratch, derive backpropagation step by step, compare activation functions and optimizers, and master dropout, batch norm, and gradient debugging. Graduate ready to train and scale deep networks with confidence.",
      thumbnail: THUMBNAILS[1],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "engineering",
      level: "Intermediate",
      tags: ["deep-learning", "neural-networks", "backpropagation", "pytorch"],
      isFeatured: true,
      studentsCount: 1180,
      rating: 4.8,
      reviewsCount: 82,
      whatYouWillLearn: [
        "Build a perceptron from scratch in NumPy",
        "Derive backpropagation with the chain rule",
        "Compare activation functions (ReLU, GELU, Swish)",
        "Tune Adam, AdamW, and learning rate schedulers",
        "Apply dropout, batch norm, and data augmentation",
        "Debug vanishing/exploding gradients and scale training",
      ],
      prerequisites: ["Python and NumPy proficiency", "Linear algebra basics (matrices, dot products)", "Calculus fundamentals (derivatives, chain rule)", "Regression / supervised learning knowledge"],
      includes: { videoHours: 12, articles: 12, resources: 8, exercises: 10, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-04-01"),
    },
    {
      title: "Deep Computer Vision (CNNs)",
      slug: "deep-computer-vision-cnns",
      description: "Convolution from scratch through transfer learning, YOLO object detection, and U-Net segmentation.",
      shortDescription: "CNNs, transfer learning, YOLO detection, and U-Net segmentation.",
      longDescription: "Understand convolution at the pixel level, trace the evolution from LeNet to EfficientNet, master transfer learning and fine-tuning, build a YOLOv8 custom detector, and implement U-Net and Mask R-CNN for image segmentation.",
      thumbnail: THUMBNAILS[2],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "engineering",
      level: "Intermediate",
      tags: ["computer-vision", "cnn", "object-detection", "segmentation", "pytorch"],
      isFeatured: false,
      studentsCount: 870,
      rating: 4.7,
      reviewsCount: 58,
      whatYouWillLearn: [
        "Implement convolution from scratch in NumPy",
        "Trace the CNN evolution: LeNet → ResNet → EfficientNet",
        "Apply transfer learning and fine-tuning strategies",
        "Build a YOLOv8 custom object detector",
        "Train Faster R-CNN for multi-class detection",
        "Implement U-Net and Mask R-CNN for segmentation",
      ],
      prerequisites: ["Python and PyTorch experience", "Deep neural network understanding", "Linear algebra fundamentals", "GPU access (Colab works)"],
      includes: { videoHours: 14, articles: 10, resources: 8, exercises: 10, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-06-10"),
    },
    {
      title: "Deep Sequence Modelling",
      slug: "deep-sequence-modelling",
      description: "RNNs, LSTMs, attention mechanisms, and the Transformer architecture — built from scratch.",
      shortDescription: "RNNs to Transformers — attention and sequence mastery.",
      longDescription: "Start with vanilla RNNs and BPTT, master LSTM and GRU gating, derive the attention mechanism from first principles, and build a complete Transformer encoder-decoder from scratch. Finish with modern applications including BERT, GPT, and Vision Transformers.",
      thumbnail: THUMBNAILS[3],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "engineering",
      level: "Advanced",
      tags: ["rnn", "lstm", "transformers", "attention", "nlp"],
      isFeatured: false,
      studentsCount: 720,
      rating: 4.8,
      reviewsCount: 49,
      whatYouWillLearn: [
        "Build a vanilla RNN from scratch with BPTT",
        "Master LSTM and GRU gating mechanisms",
        "Derive Bahdanau and Luong attention",
        "Implement multi-head self-attention",
        "Build a complete Transformer encoder-decoder from scratch",
        "Apply modern architectures: BERT, GPT, Vision Transformers",
      ],
      prerequisites: ["Strong Python and PyTorch skills", "Deep neural network fundamentals", "Calculus (chain rule, partial derivatives)"],
      includes: { videoHours: 11, articles: 8, resources: 7, exercises: 9, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-08-20"),
    },
    {
      title: "Build Your Own Mini-GPT",
      slug: "build-your-own-mini-gpt",
      description: "Tokenization, causal masked attention, and decoder-only Transformers — build a working GPT from scratch.",
      shortDescription: "Build a working GPT language model from scratch.",
      longDescription: "Implement BPE tokenization, construct positional encodings, build causal masked attention and a decoder-only Transformer block, train your Mini-GPT on Shakespeare, and explore temperature, top-k, and nucleus sampling for text generation.",
      thumbnail: THUMBNAILS[4],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "engineering",
      level: "Advanced",
      tags: ["gpt", "transformers", "language-models", "nlp", "pytorch"],
      isFeatured: true,
      studentsCount: 950,
      rating: 4.9,
      reviewsCount: 71,
      whatYouWillLearn: [
        "Implement BPE tokenization from scratch",
        "Build causal masked self-attention",
        "Construct a decoder-only Transformer block",
        "Understand positional encoding variants (sinusoidal, learned, RoPE)",
        "Train a language model with LR warmup and cosine decay",
        "Generate text with temperature, top-k, and nucleus sampling",
      ],
      prerequisites: ["Strong Python and PyTorch proficiency", "Solid Transformer understanding", "Experience training neural networks"],
      includes: { videoHours: 10, articles: 6, resources: 8, exercises: 6, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-10-05"),
    },
    {
      title: "Agentic AI & Multi-Agent Systems",
      slug: "agentic-ai-multi-agent-systems",
      description: "ReAct agents, function calling, RAG pipelines, multi-agent orchestration, and production guardrails.",
      shortDescription: "Build, orchestrate, and safeguard AI agents in production.",
      longDescription: "Move beyond chatbots into autonomous AI agents. Learn the ReAct pattern, build function-calling agents, create RAG agents with LangChain and LlamaIndex, orchestrate multi-agent workflows with CrewAI, and ship with guardrails, safety, and observability.",
      thumbnail: THUMBNAILS[5],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "engineering",
      level: "Advanced",
      tags: ["agents", "langchain", "llamaindex", "crewai", "rag"],
      isFeatured: false,
      studentsCount: 680,
      rating: 4.8,
      reviewsCount: 45,
      whatYouWillLearn: [
        "Implement the ReAct reasoning-action pattern",
        "Build function-calling agents with tool schemas",
        "Create RAG agents with LangChain and LlamaIndex",
        "Orchestrate multi-agent systems with CrewAI",
        "Implement guardrails, prompt injection defence, and safety filters",
        "Evaluate and observe agents in production",
      ],
      prerequisites: ["Python and REST API experience", "LLM and prompt engineering understanding", "Experience calling LLM APIs"],
      includes: { videoHours: 9, articles: 8, resources: 10, exercises: 8, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2025-01-10"),
    },
    {
      title: "Tree-Based ML Algorithms",
      slug: "tree-based-ml-algorithms",
      description: "Decision trees, random forests, XGBoost, LightGBM, CatBoost, SHAP explanations, and Kaggle strategies.",
      shortDescription: "Trees, boosting, SHAP, and Kaggle-winning pipelines.",
      longDescription: "Build decision trees from first principles, master bagging and random forests, deep-dive into gradient boosting and its modern implementations (XGBoost, LightGBM, CatBoost), interpret models with SHAP, and tune hyperparameters with Optuna for Kaggle-level performance.",
      thumbnail: THUMBNAILS[6],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "engineering",
      level: "Intermediate",
      tags: ["xgboost", "random-forest", "gradient-boosting", "shap", "kaggle"],
      isFeatured: false,
      studentsCount: 1050,
      rating: 4.6,
      reviewsCount: 68,
      whatYouWillLearn: [
        "Build a decision tree from scratch with entropy and Gini",
        "Understand bagging, random forests, and OOB error",
        "Master XGBoost, LightGBM, and CatBoost internals",
        "Interpret any model with SHAP values and PDP/ICE plots",
        "Tune hyperparameters efficiently with Optuna",
        "Build end-to-end Kaggle competition pipelines",
      ],
      prerequisites: ["Python, pandas, and scikit-learn", "Basic statistics (mean, variance, distributions)", "Supervised learning concepts"],
      includes: { videoHours: 10, articles: 8, resources: 6, exercises: 10, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-12-01"),
    },
    // ── Track 2: Non-Engineering (4 courses) ──
    {
      title: "Generative AI for Everyone",
      slug: "generative-ai-for-everyone",
      description: "Understand how LLMs and image generators work, evaluate AI tools, and apply generative AI across industries — no coding required.",
      shortDescription: "Understand and use generative AI — no coding required.",
      longDescription: "Demystify large language models and image generators without a single line of code. Learn how ChatGPT, Claude, Midjourney, and DALL-E work under the hood, explore use cases across marketing, education, healthcare, and finance, and navigate the ethical landscape of generative AI.",
      thumbnail: THUMBNAILS[7],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "non-engineering",
      level: "Beginner",
      tags: ["generative-ai", "chatgpt", "llm", "non-technical"],
      isFeatured: true,
      studentsCount: 1950,
      rating: 4.7,
      reviewsCount: 142,
      whatYouWillLearn: [
        "Understand how LLMs generate text (no math required)",
        "Learn how image and video generators work",
        "Evaluate AI tools for your industry and workflow",
        "Use ChatGPT and Claude effectively for real tasks",
        "Identify ethical considerations and limitations",
        "Build a personal AI productivity toolkit",
      ],
      prerequisites: ["No technical background required", "Basic familiarity with web applications"],
      includes: { videoHours: 6, articles: 12, resources: 5, exercises: 4, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-03-20"),
    },
    {
      title: "Prompt Engineering",
      slug: "prompt-engineering",
      description: "Zero-shot precision, few-shot design, chain-of-thought reasoning, system prompts, and prompt optimization.",
      shortDescription: "Master the art and science of prompting LLMs.",
      longDescription: "Go from basic prompts to advanced techniques: zero-shot precision, few-shot example design, chain-of-thought for complex reasoning, system prompt crafting, multi-step prompt chains, and A/B testing for prompt optimization. No programming required.",
      thumbnail: THUMBNAILS[8],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "non-engineering",
      level: "Beginner",
      tags: ["prompt-engineering", "chatgpt", "claude", "llm"],
      isFeatured: false,
      studentsCount: 1680,
      rating: 4.6,
      reviewsCount: 112,
      whatYouWillLearn: [
        "Craft precise zero-shot prompts",
        "Design few-shot examples for consistent outputs",
        "Apply chain-of-thought reasoning for complex tasks",
        "Write effective system prompts and personas",
        "Build multi-step prompt chains",
        "Optimize prompts with A/B testing and versioning",
      ],
      prerequisites: ["No programming required", "Basic AI tool experience (ChatGPT, Claude, etc.)", "Willingness to experiment"],
      includes: { videoHours: 5, articles: 14, resources: 8, exercises: 12, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-05-15"),
    },
    {
      title: "AI Strategy for Business Leaders",
      slug: "ai-strategy-for-business-leaders",
      description: "AI transformation roadmaps, build/buy/partner frameworks, ROI measurement, and team structures for executives.",
      shortDescription: "AI roadmaps, ROI, and team strategy for executives.",
      longDescription: "Designed for directors, VPs, and C-suite leaders. Build an AI transformation roadmap, evaluate build vs. buy vs. partner decisions, calculate AI ROI with proven frameworks, structure AI teams, and prepare board-ready presentations.",
      thumbnail: THUMBNAILS[9],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "non-engineering",
      level: "Intermediate",
      tags: ["ai-strategy", "business", "leadership", "digital-transformation"],
      isFeatured: false,
      studentsCount: 540,
      rating: 4.5,
      reviewsCount: 34,
      whatYouWillLearn: [
        "Build an AI transformation roadmap",
        "Apply build/buy/partner decision frameworks",
        "Calculate AI ROI with TCO and value-driver models",
        "Structure AI teams and define key roles",
        "Evaluate vendors with scoring rubrics",
        "Create board-ready AI strategy presentations",
      ],
      prerequisites: ["3+ years management experience", "Conceptual understanding of AI", "Interest in AI adoption and digital transformation"],
      includes: { videoHours: 7, articles: 10, resources: 8, exercises: 4, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-09-01"),
    },
    {
      title: "AI Literacy: How Intelligent Systems Shape Society",
      slug: "ai-literacy-intelligent-systems-society",
      description: "From Turing to GPT — understand how algorithms decide, where bias hides, and how AI reshapes work, education, and law.",
      shortDescription: "Understand AI's impact on society, bias, and privacy.",
      longDescription: "Trace AI's journey from Turing to ChatGPT, understand how recommendation engines and predictive models shape your world, examine bias in hiring and criminal justice, navigate privacy trade-offs, and form evidence-based views on AI regulation and the future of work.",
      thumbnail: THUMBNAILS[10],
      introVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      category: "non-engineering",
      level: "Beginner",
      tags: ["ai-literacy", "ethics", "society", "bias", "regulation"],
      isFeatured: false,
      studentsCount: 820,
      rating: 4.5,
      reviewsCount: 52,
      whatYouWillLearn: [
        "Trace AI history from Turing to GPT",
        "Understand how recommendation, search, and predictive algorithms work",
        "Identify bias in AI systems and evaluate fairness",
        "Navigate privacy trade-offs and data rights",
        "Assess AI's impact on education, healthcare, and law",
        "Form evidence-based views on AI regulation",
      ],
      prerequisites: ["No technical background required", "Curiosity about technology's societal impact"],
      includes: { videoHours: 6, articles: 14, resources: 6, exercises: 3, certificate: true, lifetimeAccess: true },
      publishedAt: new Date("2024-11-15"),
    },
  ];

  const courses: Array<{ id: string; slug: string }> = [];
  for (const def of courseDefs) {
    const course = await prisma.course.create({
      data: {
        ...def,
        isPublished: true,
        price: 0,
      },
    });
    courses.push(course);
  }

  console.log(`  Created ${courses.length} courses`);

  // ─── Step 5: Seed modules & lessons ────────────────────────────
  console.log("📖 Seeding modules and lessons...");

  // Course 1: Foundations of Regression
  await seedCourseContent(courses[0].id, [
    {
      title: "The Mathematics of Prediction",
      description: "OLS derivation, cost functions, correlation vs causation, and your first NumPy regression",
      order: 1,
      lessons: lessons([
        ["The Prediction Problem", "VIDEO", 12],
        ["Ordinary Least Squares Derivation", "VIDEO", 18],
        ["Cost Functions and Error Surfaces", "ARTICLE", 10],
        ["Correlation vs Causation", "ARTICLE", 8],
        ["Your First Regression in NumPy", "VIDEO", 20],
      ], true),
    },
    {
      title: "Gradient Descent and Optimization",
      description: "Batch, stochastic, and mini-batch gradient descent with learning rate scheduling",
      order: 2,
      lessons: lessons([
        ["Batch Gradient Descent", "VIDEO", 15],
        ["Stochastic Gradient Descent", "VIDEO", 14],
        ["Mini-Batch and Momentum", "ARTICLE", 10],
        ["Learning Rate Scheduling", "VIDEO", 16],
        ["Convergence Debugging Workshop", "VIDEO", 18],
      ]),
    },
    {
      title: "Logistic Regression and Classification",
      description: "Sigmoid, MLE, softmax, decision boundaries, and a spam classifier lab",
      order: 3,
      lessons: lessons([
        ["The Sigmoid Function and Binary Classification", "VIDEO", 14],
        ["Maximum Likelihood Estimation", "ARTICLE", 12],
        ["Softmax and Multiclass Classification", "VIDEO", 16],
        ["Decision Boundaries Visualized", "VIDEO", 12],
        ["Lab: Build a Spam Classifier", "VIDEO", 22],
      ]),
    },
    {
      title: "Regularization and Model Selection",
      description: "Bias-variance trade-off, Ridge, Lasso, Elastic Net, cross-validation, and a housing dataset lab",
      order: 4,
      lessons: lessons([
        ["The Bias-Variance Trade-Off", "VIDEO", 14],
        ["Ridge Regression (L2)", "VIDEO", 12],
        ["Lasso Regression (L1)", "ARTICLE", 10],
        ["Elastic Net", "ARTICLE", 8],
        ["Cross-Validation Strategies", "VIDEO", 14],
        ["Lab: Housing Price Prediction", "VIDEO", 25],
      ]),
    },
    {
      title: "Evaluation Metrics and Deployment",
      description: "MSE/RMSE/R², precision/recall/F1/ROC-AUC, feature engineering, Flask API deployment, and capstone",
      order: 5,
      lessons: lessons([
        ["Regression Metrics: MSE, RMSE, R²", "VIDEO", 12],
        ["Classification Metrics: Precision, Recall, F1", "VIDEO", 14],
        ["ROC-AUC and Threshold Tuning", "ARTICLE", 10],
        ["Feature Engineering Best Practices", "VIDEO", 16],
        ["Deploy Your Model as a Flask API", "VIDEO", 20],
        ["Capstone: End-to-End Regression Pipeline", "VIDEO", 25],
      ]),
    },
  ]);

  // Course 2: Mastering Deep Neural Networks
  await seedCourseContent(courses[1].id, [
    {
      title: "The Perceptron and Biological Inspiration",
      description: "History, math formulation, the XOR problem, and universal approximation",
      order: 1,
      lessons: lessons([
        ["From Neurons to Perceptrons", "VIDEO", 12],
        ["Mathematical Formulation", "ARTICLE", 10],
        ["The XOR Problem and Limitations", "VIDEO", 14],
        ["Multi-Layer Perceptrons", "VIDEO", 16],
        ["The Universal Approximation Theorem", "ARTICLE", 10],
      ], true),
    },
    {
      title: "Forward Propagation and Network Architecture",
      description: "MLP architecture, matrix operations, and activation functions compared",
      order: 2,
      lessons: lessons([
        ["Designing MLP Architectures", "VIDEO", 14],
        ["Matrix Operations in Forward Pass", "VIDEO", 16],
        ["ReLU, Sigmoid, Tanh Compared", "ARTICLE", 10],
        ["GELU, Swish, and Modern Activations", "ARTICLE", 8],
        ["Lab: Forward Pass from Scratch", "VIDEO", 20],
      ]),
    },
    {
      title: "Backpropagation and the Chain Rule",
      description: "Step-by-step derivation, computational graphs, gradient checking, and MNIST lab",
      order: 3,
      lessons: lessons([
        ["The Chain Rule Refresher", "ARTICLE", 8],
        ["Backpropagation Step by Step", "VIDEO", 20],
        ["Computational Graphs", "VIDEO", 14],
        ["Gradient Checking", "ARTICLE", 10],
        ["Lab: Train a Network on MNIST", "VIDEO", 22],
      ]),
    },
    {
      title: "Optimizers and Learning Rate Strategies",
      description: "SGD+momentum, RMSProp, Adam/AdamW, LR schedulers, optimizer comparison, and CIFAR-10 lab",
      order: 4,
      lessons: lessons([
        ["SGD with Momentum", "VIDEO", 14],
        ["RMSProp", "ARTICLE", 10],
        ["Adam and AdamW", "VIDEO", 16],
        ["Learning Rate Schedulers", "VIDEO", 14],
        ["Optimizer Comparison Experiment", "VIDEO", 18],
        ["Lab: CIFAR-10 with Different Optimizers", "VIDEO", 22],
      ]),
    },
    {
      title: "Regularization Techniques",
      description: "Dropout, batch norm, layer norm, weight initialization, data augmentation, and early stopping",
      order: 5,
      lessons: lessons([
        ["Dropout: Theory and Practice", "VIDEO", 14],
        ["Batch Normalization", "VIDEO", 16],
        ["Layer Normalization", "ARTICLE", 10],
        ["Weight Initialization Strategies", "ARTICLE", 8],
        ["Data Augmentation Pipelines", "VIDEO", 14],
        ["Early Stopping and Checkpointing", "VIDEO", 12],
      ]),
    },
    {
      title: "Debugging and Scaling",
      description: "Vanishing/exploding gradients, gradient clipping, mixed precision, distributed training, and capstone",
      order: 6,
      lessons: lessons([
        ["Vanishing and Exploding Gradients", "VIDEO", 16],
        ["Gradient Clipping Techniques", "ARTICLE", 10],
        ["Mixed Precision Training", "VIDEO", 14],
        ["Distributed Training Basics", "VIDEO", 16],
        ["Capstone: Train a Production-Grade Network", "VIDEO", 25],
      ]),
    },
  ]);

  // Course 3: Deep Computer Vision (CNNs)
  await seedCourseContent(courses[2].id, [
    {
      title: "Image Fundamentals and Convolution",
      description: "Tensors, pixels, convolution operations, feature maps, pooling, and a NumPy convolution lab",
      order: 1,
      lessons: lessons([
        ["Images as Tensors", "VIDEO", 12],
        ["Pixels, Channels, and Color Spaces", "ARTICLE", 8],
        ["The Convolution Operation", "VIDEO", 18],
        ["Feature Maps and Filters", "VIDEO", 14],
        ["Pooling Operations", "ARTICLE", 10],
        ["Lab: Convolution from Scratch in NumPy", "VIDEO", 22],
      ], true),
    },
    {
      title: "Landmark CNN Architectures",
      description: "LeNet-5, AlexNet, VGG, GoogLeNet, ResNet, MobileNet/EfficientNet, and a ResNet-18 lab",
      order: 2,
      lessons: lessons([
        ["LeNet-5: Where It All Began", "VIDEO", 12],
        ["AlexNet and the ImageNet Moment", "ARTICLE", 10],
        ["VGG: Depth with Simplicity", "VIDEO", 14],
        ["GoogLeNet and Inception Modules", "VIDEO", 14],
        ["ResNet: Skip Connections", "VIDEO", 18],
        ["MobileNet and EfficientNet", "ARTICLE", 10],
        ["Lab: Train ResNet-18 on Custom Data", "VIDEO", 22],
      ]),
    },
    {
      title: "Transfer Learning and Fine-Tuning",
      description: "Feature reuse, extraction, fine-tuning strategies, augmentation pipelines, and a medical imaging lab",
      order: 3,
      lessons: lessons([
        ["Why Transfer Learning Works", "VIDEO", 14],
        ["Feature Extraction", "VIDEO", 16],
        ["Fine-Tuning Strategies", "ARTICLE", 10],
        ["Augmentation Pipelines", "VIDEO", 14],
        ["Lab: Medical Image Classification", "VIDEO", 22],
      ]),
    },
    {
      title: "Object Detection",
      description: "IoU, anchors, NMS, R-CNN family, YOLO, SSD/RetinaNet, DETR, and a YOLOv8 custom data lab",
      order: 4,
      lessons: lessons([
        ["IoU, Anchors, and NMS", "VIDEO", 16],
        ["R-CNN Family: From R-CNN to Faster R-CNN", "VIDEO", 18],
        ["YOLO v5 → v8 Evolution", "VIDEO", 16],
        ["SSD and RetinaNet", "ARTICLE", 10],
        ["DETR: End-to-End Detection", "ARTICLE", 10],
        ["Lab: YOLOv8 on Custom Dataset", "VIDEO", 25],
      ]),
    },
    {
      title: "Image Segmentation",
      description: "Semantic, instance, and panoptic segmentation, U-Net, Mask R-CNN, and an autonomous driving lab",
      order: 5,
      lessons: lessons([
        ["Semantic vs Instance vs Panoptic", "VIDEO", 14],
        ["U-Net Architecture", "VIDEO", 16],
        ["Mask R-CNN", "VIDEO", 16],
        ["Segmentation Loss Functions", "ARTICLE", 10],
        ["Lab: Autonomous Driving Segmentation", "VIDEO", 25],
        ["Computer Vision Capstone Project", "VIDEO", 20],
      ]),
    },
  ]);

  // Course 4: Deep Sequence Modelling
  await seedCourseContent(courses[3].id, [
    {
      title: "Sequential Data and RNNs",
      description: "Why order matters, vanilla RNN with BPTT, vanishing gradient, char-level LM, and seq-to-seq taxonomy",
      order: 1,
      lessons: lessons([
        ["Why Order Matters in Data", "VIDEO", 12],
        ["Vanilla RNN and BPTT", "VIDEO", 18],
        ["The Vanishing Gradient Problem", "ARTICLE", 10],
        ["Character-Level Language Model", "VIDEO", 20],
        ["Sequence-to-Sequence Taxonomy", "ARTICLE", 8],
      ], true),
    },
    {
      title: "Gated Recurrent Architectures",
      description: "LSTM gates, LSTM from scratch, GRU, bidirectional and stacked architectures, and sentiment analysis lab",
      order: 2,
      lessons: lessons([
        ["LSTM: Forget, Input, and Output Gates", "VIDEO", 18],
        ["Building an LSTM from Scratch", "VIDEO", 22],
        ["GRU: A Simpler Alternative", "VIDEO", 14],
        ["Bidirectional RNNs", "ARTICLE", 10],
        ["Stacked Architectures", "ARTICLE", 8],
        ["Lab: Sentiment Analysis with LSTM", "VIDEO", 22],
      ]),
    },
    {
      title: "The Attention Mechanism",
      description: "Attention intuition, Bahdanau, Luong, self-attention, and a machine translation lab",
      order: 3,
      lessons: lessons([
        ["Attention Intuition: Where to Look", "VIDEO", 14],
        ["Bahdanau (Additive) Attention", "VIDEO", 16],
        ["Luong (Multiplicative) Attention", "ARTICLE", 10],
        ["Self-Attention", "VIDEO", 16],
        ["Lab: Machine Translation with Attention", "VIDEO", 22],
      ]),
    },
    {
      title: "The Transformer Architecture",
      description: "Paper walkthrough, Q/K/V, multi-head attention, positional encoding, FFN + layer norm, and build from scratch",
      order: 4,
      lessons: lessons([
        ["'Attention Is All You Need' Walkthrough", "VIDEO", 18],
        ["Query, Key, Value Intuition", "VIDEO", 14],
        ["Multi-Head Attention", "VIDEO", 16],
        ["Positional Encoding", "ARTICLE", 10],
        ["Feed-Forward Network and Layer Norm", "ARTICLE", 8],
        ["Lab: Transformer from Scratch", "VIDEO", 28],
      ]),
    },
    {
      title: "Applications and Modern Extensions",
      description: "BERT, GPT, Vision Transformers, time-series forecasting, and NER capstone",
      order: 5,
      lessons: lessons([
        ["BERT: Bidirectional Understanding", "VIDEO", 14],
        ["GPT: Autoregressive Generation", "VIDEO", 14],
        ["Vision Transformers (ViT)", "ARTICLE", 10],
        ["Time-Series Forecasting with Transformers", "VIDEO", 16],
        ["Capstone: Named Entity Recognition", "VIDEO", 22],
      ]),
    },
  ]);

  // Course 5: Build Your Own Mini-GPT
  await seedCourseContent(courses[4].id, [
    {
      title: "Tokenization and Text Representation",
      description: "What we're building, char vs subword, BPE algorithm, BPE from scratch, and vocab trade-offs",
      order: 1,
      lessons: lessons([
        ["What We're Building: Mini-GPT Overview", "VIDEO", 10],
        ["Character vs Subword Tokenization", "VIDEO", 14],
        ["The BPE Algorithm", "ARTICLE", 10],
        ["Lab: BPE Tokenizer from Scratch", "VIDEO", 22],
        ["Vocabulary Size Trade-Offs", "ARTICLE", 8],
      ], true),
    },
    {
      title: "Positional Encoding and Embeddings",
      description: "Token embeddings, sinusoidal PE, learned and RoPE variants, and an embedding layer lab",
      order: 2,
      lessons: lessons([
        ["Token Embeddings", "VIDEO", 12],
        ["Sinusoidal Positional Encoding", "VIDEO", 16],
        ["Learned and RoPE Positional Encodings", "ARTICLE", 10],
        ["Lab: Building the Embedding Layer", "VIDEO", 18],
      ]),
    },
    {
      title: "The Decoder-Only Transformer Block",
      description: "Causal masked attention, multi-head attention, FFN + layer norm, residual connections, and decoder block lab",
      order: 3,
      lessons: lessons([
        ["Causal Masked Self-Attention", "VIDEO", 18],
        ["Multi-Head Attention Implementation", "VIDEO", 20],
        ["Feed-Forward Network and Layer Norm", "ARTICLE", 10],
        ["Residual Connections", "ARTICLE", 8],
        ["Lab: Building a Decoder Block", "VIDEO", 22],
      ]),
    },
    {
      title: "Training Your Mini-GPT",
      description: "Next-token prediction, cross-entropy loss, data prep, LR warmup/cosine decay, Shakespeare training, and monitoring",
      order: 4,
      lessons: lessons([
        ["Next-Token Prediction Objective", "VIDEO", 14],
        ["Cross-Entropy Loss for Language Models", "ARTICLE", 10],
        ["Data Preparation and Batching", "VIDEO", 16],
        ["Learning Rate Warmup and Cosine Decay", "VIDEO", 14],
        ["Lab: Training on Shakespeare", "VIDEO", 25],
        ["Monitoring Training with Weights & Biases", "VIDEO", 14],
      ]),
    },
    {
      title: "Text Generation and Sampling",
      description: "Greedy/beam search, temperature, top-k/nucleus, repetition penalties, interactive demo, and Mini-GPT to GPT-4",
      order: 5,
      lessons: lessons([
        ["Greedy and Beam Search", "VIDEO", 14],
        ["Temperature Scaling", "VIDEO", 12],
        ["Top-k and Nucleus Sampling", "ARTICLE", 10],
        ["Repetition Penalties", "ARTICLE", 8],
        ["Lab: Interactive Text Generation Demo", "VIDEO", 20],
        ["From Mini-GPT to GPT-4: What Changed", "VIDEO", 16],
      ]),
    },
  ]);

  // Course 6: Agentic AI & Multi-Agent Systems
  await seedCourseContent(courses[5].id, [
    {
      title: "Foundations of AI Agents",
      description: "From chatbots to agents, anatomy, architectures, ReAct pattern, and cognitive architectures",
      order: 1,
      lessons: lessons([
        ["From Chatbots to Autonomous Agents", "VIDEO", 12],
        ["Anatomy of an AI Agent", "VIDEO", 14],
        ["Agent Architectures Overview", "ARTICLE", 10],
        ["The ReAct Pattern", "VIDEO", 16],
        ["Cognitive Architectures for Agents", "ARTICLE", 10],
      ], true),
    },
    {
      title: "Tool-Use and Function Calling",
      description: "Function calling APIs, tool schema design, web search agent, DB agent, and research agent lab",
      order: 2,
      lessons: lessons([
        ["Function Calling APIs", "VIDEO", 16],
        ["Tool Schema Design", "ARTICLE", 10],
        ["Building a Web Search Agent", "VIDEO", 18],
        ["Building a Database Query Agent", "VIDEO", 18],
        ["Lab: Research Assistant Agent", "VIDEO", 22],
      ]),
    },
    {
      title: "Agent Frameworks",
      description: "LangChain agents, LlamaIndex agents, memory systems, custom tools, and customer support agent lab",
      order: 3,
      lessons: lessons([
        ["LangChain Agents Deep Dive", "VIDEO", 18],
        ["LlamaIndex Agents", "VIDEO", 16],
        ["Memory Systems for Agents", "ARTICLE", 10],
        ["Building Custom Tools", "VIDEO", 16],
        ["Lab: Customer Support Agent", "VIDEO", 22],
      ]),
    },
    {
      title: "Multi-Agent Orchestration",
      description: "Multi-agent patterns, CrewAI, AutoGen, communication protocols, and content pipeline lab",
      order: 4,
      lessons: lessons([
        ["Multi-Agent Design Patterns", "VIDEO", 16],
        ["CrewAI: Role-Based Agents", "VIDEO", 18],
        ["AutoGen: Conversational Agents", "VIDEO", 16],
        ["Agent Communication Protocols", "ARTICLE", 10],
        ["Lab: Content Creation Pipeline", "VIDEO", 22],
      ]),
    },
    {
      title: "Production Guardrails and Safety",
      description: "Guardrails, prompt injection, evaluation metrics, HITL, observability, and capstone deployment",
      order: 5,
      lessons: lessons([
        ["Guardrails and Output Filtering", "VIDEO", 14],
        ["Prompt Injection Defence", "VIDEO", 16],
        ["Agent Evaluation Metrics", "ARTICLE", 10],
        ["Human-in-the-Loop Patterns", "ARTICLE", 10],
        ["Observability and Tracing", "VIDEO", 14],
        ["Capstone: Production Agent Deployment", "VIDEO", 25],
      ]),
    },
  ]);

  // Course 7: Tree-Based ML Algorithms
  await seedCourseContent(courses[6].id, [
    {
      title: "Decision Trees from First Principles",
      description: "Why trees dominate tabular data, entropy, info gain, Gini/CART, pruning, and a tree from scratch lab",
      order: 1,
      lessons: lessons([
        ["Why Trees Dominate Tabular Data", "VIDEO", 12],
        ["Entropy and Information Gain", "VIDEO", 16],
        ["Gini Impurity and CART", "ARTICLE", 10],
        ["Pruning Strategies", "ARTICLE", 8],
        ["Lab: Decision Tree from Scratch", "VIDEO", 22],
      ], true),
    },
    {
      title: "Ensemble Methods — Bagging",
      description: "Bootstrap aggregating, random forests, OOB error, Extra Trees/Isolation Forests, and credit scoring lab",
      order: 2,
      lessons: lessons([
        ["Bootstrap Aggregating", "VIDEO", 14],
        ["Random Forests", "VIDEO", 16],
        ["Out-of-Bag Error Estimation", "ARTICLE", 8],
        ["Extra Trees and Isolation Forests", "ARTICLE", 10],
        ["Lab: Credit Scoring with Random Forest", "VIDEO", 22],
      ]),
    },
    {
      title: "Gradient Boosting Fundamentals",
      description: "Boosting intuition, AdaBoost, gradient boosting, shrinkage/regularization, and GB from scratch lab",
      order: 3,
      lessons: lessons([
        ["Boosting Intuition", "VIDEO", 14],
        ["AdaBoost Algorithm", "VIDEO", 16],
        ["Gradient Boosting Explained", "VIDEO", 18],
        ["Shrinkage and Regularization", "ARTICLE", 10],
        ["Lab: Gradient Boosting from Scratch", "VIDEO", 22],
      ]),
    },
    {
      title: "XGBoost, LightGBM, CatBoost",
      description: "XGBoost internals, LightGBM histogram splits, CatBoost ordered boosting, benchmarking, GPU training, and Kaggle lab",
      order: 4,
      lessons: lessons([
        ["XGBoost Internals", "VIDEO", 18],
        ["LightGBM: Histogram-Based Splits", "VIDEO", 16],
        ["CatBoost: Ordered Boosting", "VIDEO", 16],
        ["Benchmarking the Big Three", "ARTICLE", 10],
        ["GPU-Accelerated Training", "ARTICLE", 8],
        ["Lab: Kaggle Competition Walkthrough", "VIDEO", 25],
      ]),
    },
    {
      title: "Interpretability and Tuning",
      description: "Feature importance, SHAP values, PDP/ICE plots, Optuna tuning, Kaggle strategy, and capstone pipeline",
      order: 5,
      lessons: lessons([
        ["Feature Importance Methods", "VIDEO", 14],
        ["SHAP Values Deep Dive", "VIDEO", 18],
        ["PDP and ICE Plots", "ARTICLE", 10],
        ["Hyperparameter Tuning with Optuna", "VIDEO", 16],
        ["Kaggle Competition Strategy", "ARTICLE", 10],
        ["Capstone: End-to-End ML Pipeline", "VIDEO", 25],
      ]),
    },
  ]);

  // Course 8: Generative AI for Everyone
  await seedCourseContent(courses[7].id, [
    {
      title: "What is Generative AI?",
      description: "The revolution, history, generation vs creation, types of GenAI, and your first AI conversation demo",
      order: 1,
      lessons: lessons([
        ["The Generative AI Revolution", "VIDEO", 10],
        ["A Brief History of AI", "ARTICLE", 8],
        ["Generation vs Creation", "VIDEO", 12],
        ["Types of Generative AI", "ARTICLE", 8],
        ["Demo: Your First AI Conversation", "VIDEO", 10],
      ], true),
    },
    {
      title: "How LLMs Work (No Math)",
      description: "Next-word prediction, internet training, tokens and context, hallucinations, and comparing LLMs",
      order: 2,
      lessons: lessons([
        ["Next-Word Prediction: The Core Idea", "VIDEO", 12],
        ["Trained on the Internet", "ARTICLE", 8],
        ["Tokens and Context Windows", "VIDEO", 10],
        ["Hallucinations: When AI Makes Things Up", "VIDEO", 12],
        ["Comparing LLMs: ChatGPT, Claude, Gemini", "ARTICLE", 10],
      ]),
    },
    {
      title: "Image, Video, and Audio Generation",
      description: "GANs to diffusion, Midjourney/DALL-E hands-on, video generation, audio AI, and a marketing campaign demo",
      order: 3,
      lessons: lessons([
        ["From GANs to Diffusion Models", "VIDEO", 12],
        ["Hands-On: Midjourney and DALL-E", "VIDEO", 14],
        ["Video Generation: Sora and Beyond", "ARTICLE", 8],
        ["Audio AI: Music and Voice", "ARTICLE", 8],
        ["Demo: AI-Powered Marketing Campaign", "VIDEO", 14],
      ]),
    },
    {
      title: "Use Cases Across Industries",
      description: "Marketing, education, healthcare, finance, software development, and a personal toolkit exercise",
      order: 4,
      lessons: lessons([
        ["Marketing and Content Creation", "VIDEO", 12],
        ["Education and Learning", "ARTICLE", 8],
        ["Healthcare Applications", "VIDEO", 10],
        ["Finance and Legal", "ARTICLE", 8],
        ["Software Development", "VIDEO", 10],
        ["Building Your Personal AI Toolkit", "VIDEO", 14],
      ]),
    },
    {
      title: "Ethics, Limitations, and Future",
      description: "Deepfakes, copyright, job transformation, environmental cost, and the road ahead",
      order: 5,
      lessons: lessons([
        ["Deepfakes and Misinformation", "VIDEO", 12],
        ["Copyright and Intellectual Property", "ARTICLE", 10],
        ["Job Transformation, Not Elimination", "VIDEO", 12],
        ["Environmental Cost of AI", "ARTICLE", 8],
        ["The Road Ahead", "VIDEO", 10],
      ]),
    },
  ]);

  // Course 9: Prompt Engineering
  await seedCourseContent(courses[8].id, [
    {
      title: "Prompt Engineering Fundamentals",
      description: "Why prompting matters, anatomy of a prompt, zero-shot, common mistakes, and a bad→great prompt demo",
      order: 1,
      lessons: lessons([
        ["Why Prompting Matters", "VIDEO", 10],
        ["Anatomy of a Prompt", "ARTICLE", 8],
        ["Zero-Shot Prompting", "VIDEO", 12],
        ["Common Prompting Mistakes", "ARTICLE", 8],
        ["Demo: From Bad to Great Prompt", "VIDEO", 14],
      ], true),
    },
    {
      title: "Few-Shot and In-Context Learning",
      description: "Few-shot prompting, example selection, in-context learning, when few-shot wins, and a product categorizer lab",
      order: 2,
      lessons: lessons([
        ["Few-Shot Prompting", "VIDEO", 12],
        ["Selecting the Right Examples", "VIDEO", 14],
        ["In-Context Learning Explained", "ARTICLE", 10],
        ["When Few-Shot Beats Zero-Shot", "ARTICLE", 8],
        ["Lab: Product Categorizer", "VIDEO", 16],
      ]),
    },
    {
      title: "Chain-of-Thought and Advanced Reasoning",
      description: "CoT prompting, self-consistency, Tree/Graph-of-Thought, ReAct, and a math/logic lab",
      order: 3,
      lessons: lessons([
        ["Chain-of-Thought Prompting", "VIDEO", 14],
        ["Self-Consistency Sampling", "VIDEO", 12],
        ["Tree-of-Thought and Graph-of-Thought", "ARTICLE", 10],
        ["ReAct Prompting", "VIDEO", 14],
        ["Lab: Math and Logic Problem Solving", "VIDEO", 16],
      ]),
    },
    {
      title: "System Prompts and Persona Design",
      description: "System prompts, persona engineering, output format control, guardrails, and a legal analyzer lab",
      order: 4,
      lessons: lessons([
        ["Crafting System Prompts", "VIDEO", 12],
        ["Persona Engineering", "VIDEO", 14],
        ["Output Format Control", "ARTICLE", 10],
        ["Prompt Guardrails", "ARTICLE", 8],
        ["Lab: Legal Document Analyzer", "VIDEO", 18],
      ]),
    },
    {
      title: "Prompt Chaining and Optimization",
      description: "Chaining, templates, A/B testing, versioning, research pipeline lab, and capstone",
      order: 5,
      lessons: lessons([
        ["Prompt Chaining", "VIDEO", 14],
        ["Prompt Templates", "ARTICLE", 8],
        ["A/B Testing Prompts", "VIDEO", 12],
        ["Prompt Versioning", "ARTICLE", 8],
        ["Lab: Research Pipeline", "VIDEO", 18],
        ["Capstone: Optimized Prompt System", "VIDEO", 16],
      ]),
    },
  ]);

  // Course 10: AI Strategy for Business Leaders
  await seedCourseContent(courses[9].id, [
    {
      title: "The AI Landscape for Decision-Makers",
      description: "Why AI strategy now, terminology guide, market landscape, case studies, and hype vs reality",
      order: 1,
      lessons: lessons([
        ["Why AI Strategy Matters Now", "VIDEO", 12],
        ["AI Terminology Guide for Executives", "ARTICLE", 10],
        ["The AI Market Landscape", "VIDEO", 14],
        ["Case Study: Netflix, Amazon, and Google", "VIDEO", 16],
        ["Hype vs Reality: Separating Signal from Noise", "ARTICLE", 10],
      ], true),
    },
    {
      title: "Building Your AI Transformation Roadmap",
      description: "McKinsey maturity model, effort-value matrix, phasing initiatives, change management, and a 12-month roadmap lab",
      order: 2,
      lessons: lessons([
        ["McKinsey AI Maturity Model", "VIDEO", 14],
        ["The Effort-Value Matrix", "VIDEO", 12],
        ["Phasing AI Initiatives", "ARTICLE", 10],
        ["Change Management for AI Adoption", "ARTICLE", 10],
        ["Lab: Build a 12-Month AI Roadmap", "VIDEO", 18],
      ]),
    },
    {
      title: "Build vs. Buy vs. Partner",
      description: "Decision framework, vendor scoring, open-source vs proprietary, data infrastructure, and a mid-size company case study",
      order: 3,
      lessons: lessons([
        ["The Build/Buy/Partner Decision Framework", "VIDEO", 14],
        ["Vendor Scoring Rubric", "ARTICLE", 10],
        ["Open-Source vs Proprietary AI", "VIDEO", 12],
        ["Data Infrastructure Requirements", "ARTICLE", 10],
        ["Case Study: Mid-Size Company AI Adoption", "VIDEO", 16],
      ]),
    },
    {
      title: "Measuring AI ROI",
      description: "TCO, value-driver models, BCG impact framework, business case templates, and an ROI calculation lab",
      order: 4,
      lessons: lessons([
        ["Total Cost of Ownership for AI", "VIDEO", 14],
        ["Value-Driver Models", "VIDEO", 12],
        ["BCG AI Impact Framework", "ARTICLE", 10],
        ["Business Case Templates", "ARTICLE", 10],
        ["Lab: ROI Calculation Workshop", "VIDEO", 18],
      ]),
    },
    {
      title: "AI Team Structure and Talent",
      description: "Team models, key roles, upskilling, governance/ethics boards, board presentation playbook, and capstone strategy deck",
      order: 5,
      lessons: lessons([
        ["AI Team Models: Centralized vs Federated", "VIDEO", 14],
        ["Key Roles: Data Scientist to ML Engineer", "ARTICLE", 10],
        ["Upskilling Your Existing Workforce", "VIDEO", 12],
        ["AI Governance and Ethics Boards", "ARTICLE", 10],
        ["Board Presentation Playbook", "VIDEO", 14],
        ["Capstone: Your AI Strategy Deck", "VIDEO", 18],
      ]),
    },
  ]);

  // Course 11: AI Literacy — How Intelligent Systems Shape Society
  await seedCourseContent(courses[10].id, [
    {
      title: "The Story of AI",
      description: "Why literacy matters, Turing to ChatGPT timeline, AI winters and summers, pattern matching, and narrow vs general AI",
      order: 1,
      lessons: lessons([
        ["Why AI Literacy Matters", "VIDEO", 10],
        ["Turing to ChatGPT: A Timeline", "ARTICLE", 10],
        ["AI Winters and AI Summers", "VIDEO", 12],
        ["Pattern Matching, Not Thinking", "VIDEO", 12],
        ["Narrow AI vs General AI", "ARTICLE", 8],
      ], true),
    },
    {
      title: "How Algorithms Decide",
      description: "Recommendation engines, search algorithms, predictive models, content moderation, and autonomous decision-making",
      order: 2,
      lessons: lessons([
        ["Recommendation Engines: How Netflix Knows You", "VIDEO", 12],
        ["Search Algorithms: From Google to Perplexity", "VIDEO", 14],
        ["Predictive Models in Daily Life", "ARTICLE", 10],
        ["Content Moderation at Scale", "ARTICLE", 8],
        ["Autonomous Decision-Making", "VIDEO", 12],
      ]),
    },
    {
      title: "Privacy, Surveillance, and Data Rights",
      description: "Surveillance economy, facial recognition, GDPR/CCPA/DPDP, digital consent, and a digital footprint audit lab",
      order: 3,
      lessons: lessons([
        ["The Surveillance Economy", "VIDEO", 14],
        ["Facial Recognition: Convenience vs Control", "VIDEO", 12],
        ["GDPR, CCPA, and India's DPDP Act", "ARTICLE", 10],
        ["Digital Consent: What You Actually Agree To", "ARTICLE", 8],
        ["Lab: Audit Your Digital Footprint", "VIDEO", 14],
      ]),
    },
    {
      title: "Bias, Fairness, and Justice",
      description: "Where bias comes from, hiring/criminal justice case studies, fairness definitions, algorithmic auditing, and regulation debate",
      order: 4,
      lessons: lessons([
        ["Where Algorithmic Bias Comes From", "VIDEO", 14],
        ["Case Study: Hiring and Criminal Justice", "VIDEO", 16],
        ["Defining Fairness: No Easy Answers", "ARTICLE", 10],
        ["Algorithmic Auditing", "ARTICLE", 10],
        ["The Regulation Debate", "VIDEO", 12],
      ]),
    },
    {
      title: "AI in Education, Healthcare, and Law",
      description: "AI's impact on education, healthcare, legal systems, and the digital divide",
      order: 5,
      lessons: lessons([
        ["AI in Education: Tutor or Threat?", "VIDEO", 14],
        ["AI in Healthcare: Diagnosis to Drug Discovery", "VIDEO", 14],
        ["Legal AI: Courts, Contracts, and Compliance", "ARTICLE", 10],
        ["The Digital Divide", "ARTICLE", 10],
      ]),
    },
    {
      title: "The Future of Work and Society",
      description: "Jobs transformed, skills that matter, UBI and economic models, governance, and a position paper capstone",
      order: 6,
      lessons: lessons([
        ["Jobs That Disappear, Transform, and Emerge", "VIDEO", 14],
        ["Skills That Matter in an AI World", "VIDEO", 12],
        ["UBI and Economic Models", "ARTICLE", 10],
        ["AI Governance and the EU AI Act", "ARTICLE", 10],
        ["Capstone: Write Your AI Position Paper", "VIDEO", 16],
      ]),
    },
  ]);

  console.log("✅ All modules and lessons seeded");

  // ─── Step 6: Grant access ──────────────────────────────────────
  console.log("🔑 Granting course access...");

  // Org-level access: all 11 courses
  for (const course of courses) {
    await prisma.organizationCourseAccess.create({
      data: {
        organizationId: org.id,
        courseId: course.id,
      },
    });
  }

  // B2C student: enrolled in all 11 courses
  for (const course of courses) {
    await prisma.courseEnrollment.create({
      data: {
        userId: student.id,
        courseId: course.id,
        accessSource: "INDIVIDUAL",
      },
    });
  }

  console.log(`  Org access: ${courses.length} courses | Student enrollments: ${courses.length} courses`);

  // ─── Done ──────────────────────────────────────────────────────
  console.log("\n🎉 Seed complete!");
  console.log("\nTest accounts:");
  console.log("  Platform Admin:     admin@lexai.com / admin123456");
  console.log("  Institution Admin:  admin@demo-university.edu / instadmin123");
  console.log("  Premium Student:    student@gmail.com / student123");
  console.log("\nInstitutional students (pre-registered):");
  console.log("  priya.sharma@demo-university.edu / STU-2025-001");
  console.log("  rohan.iyer@demo-university.edu / STU-2025-002");
  console.log("  ananya.gupta@demo-university.edu / STU-2025-003");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
