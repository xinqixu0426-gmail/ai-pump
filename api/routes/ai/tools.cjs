const AI_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'query_recipe_cost_by_name',
            description: '通过配方名称查询默认/保存的最新成本。当用户只问“V750的默认成本是多少”时使用；如果用户提到机筒长度、机筒高度、customBarrelLength、180mm 等动态条件，不要用本工具，改用 preview_pump_shell_cost 或 preview_recipe_cost。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '配方名称或泵壳型号' }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'query_recipe_cost_by_id',
            description: '通过配方ID查成本',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: '配方ID' }
                },
                required: ['id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'full_calculate',
            description: '一站式BOM综合计算（配方+线圈+浮球+电缆+包材）。当用户提到完整报价、总成本时使用',
            parameters: {
                type: 'object',
                properties: {
                    pumphousing_model: { type: 'string', description: '泵壳型号' },
                    stator: { type: 'string', description: '定子规格-片数，如"12-120"' },
                    hasFloat: { type: 'boolean', description: '是否带浮球' },
                    cableLength: { type: 'number', description: '电缆长度（米）' },
                    boxType: { type: 'string', description: '包装类型' },
                    floatWire: { type: 'string', description: '浮球线径（可选）' },
                    cableWire: { type: 'string', description: '电缆线径（可选）' },
                    cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'], description: '铜套规格：普通铜套 standard，新界式 xinjie' }
                },
                required: ['pumphousing_model']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_copper_price',
            description: '获取实时铜价（元/吨、元/千克）',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculate_coil_cost',
            description: '查询或计算线圈转子数据与成本（支持插值）。未同时指定材质和槽眼时，会先返回该规格片数下全部正式方案，禁止默认选择小眼。',
            parameters: {
                type: 'object',
                properties: {
                    spec: { type: 'string', description: '定子规格' },
                    sheets: { type: 'number', description: '片数' },
                    wireWeight: { type: 'number', description: '自定义线重（可选）' },
                    material: { type: 'string', enum: ['钢带', '冷轧'], description: '材质（可选）' },
                    slotType: { type: 'string', enum: ['小眼', '国标眼'], description: '槽眼（可选；不填时列出全部匹配方案，不默认小眼）' }
                },
                required: ['spec', 'sheets']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_coil_specs',
            description: '获取数据库中所有可用的线圈规格及其片数列表',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_all_recipes',
            description: '获取所有配方列表',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_all_parts',
            description: '获取所有零件列表',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'dynamic_config_cost',
            description: '计算动态配置成本（浮球、电缆、包材）',
            parameters: {
                type: 'object',
                properties: {
                    stator: { type: 'string', description: '定子规格-片数' },
                    hasFloat: { type: 'boolean' },
                    cableLength: { type: 'number' },
                    boxType: { type: 'string' },
                    floatWire: { type: 'string' },
                    cableWire: { type: 'string' },
                    cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_recent_orders',
            description: '获取最近的订单列表',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: '返回的订单数量，默认10' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_part',
            description: '新建/录入零件到数据库。当用户说"新建零件""添加零件""录入一个叫XX的零件"时使用',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '型号/名称' },
                    category: { type: 'string', description: '类别（如 轴承、螺丝、密封件、电容 等），默认"其他"' },
                    subcategory: { type: 'string', description: '包装二级分类：外包装、内衬或固定包材；仅 category=包装 时使用' },
                    price: { type: 'number', description: '单价（元）' },
                    supplier: { type: 'string', description: '供应商名称，默认"-"' },
                    stock: { type: 'number', description: '初始库存数量，默认0' }
                },
                required: ['model', 'price']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_order',
            description: '新建订单。当用户说"新建订单""下一个订单""给XX客户开个订单"时使用。可以直接附带要生产的产品。',
            parameters: {
                type: 'object',
                properties: {
                    customerName: { type: 'string', description: '客户名称' },
                    contractNo: { type: 'string', description: '合同号（可选）' },
                    remark: { type: 'string', description: '备注（可选）' },
                    status: { type: 'string', description: '新建订单固定为“待确认”，确认后再进入采购流程' },
                    items: {
                        type: 'array',
                        description: '要包含在订单中的产品配方列表（可选）',
                        items: {
                            type: 'object',
                            properties: {
                                recipeName: { type: 'string', description: '配方名称（尽量精确）' },
                                qty: { type: 'number', description: '需要的数量' }
                            },
                            required: ['recipeName', 'qty']
                        }
                    }
                },
                required: ['customerName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_recipe_to_order',
            description: '向已存在的订单中追加配方/产品。当用户说"给订单XX加一台YY"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单的ID号码' },
                    recipeName: { type: 'string', description: '要添加的配方名称或泵壳型号' },
                    qty: { type: 'number', description: '数量' }
                },
                required: ['orderId', 'recipeName', 'qty']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_part',
            description: '修改零件信息（价格、库存、供应商等）。当用户说"把XX零件的价格改成YY""XX的库存加10"时使用',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '要修改的零件型号/名称（用于查找）' },
                    price: { type: 'number', description: '新的单价（可选）' },
                    stock: { type: 'number', description: '新的库存数量（可选）' },
                    stockDelta: { type: 'number', description: '库存增减数量，正数增加负数减少（可选，与stock二选一）' },
                    supplier: { type: 'string', description: '新的供应商（可选）' },
                    category: { type: 'string', description: '新的类别（可选）' },
                    subcategory: { type: 'string', description: '新的包装二级分类（可选）' }
                },
                required: ['model']
            }
        }
    },
    // ── 第一组：订单全生命周期 ──
    {
        type: 'function',
        function: {
            name: 'get_order_detail',
            description: '查看某个订单的完整详情（含配方列表、采购清单、TODO）。当用户说"看看订单5""订单5的详情"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' }
                },
                required: ['orderId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_order_status',
            description: '执行允许的订单状态动作：确认订单、关闭订单或取消订单。采购中和采购完成由数量进度自动推导。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    status: { type: 'string', description: '新状态：待采购/已关闭/已取消' },
                    reason: { type: 'string', description: '取消订单时必填原因' }
                },
                required: ['orderId', 'status']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'remove_recipe_from_order',
            description: '从订单中移除某个配方/产品。当用户说"把订单5里的V750删掉"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    recipeName: { type: 'string', description: '要移除的配方名称' }
                },
                required: ['orderId', 'recipeName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_order_item',
            description: '修改订单中某个配方的数量或出厂价。当用户说"把订单5里V750改成3台"或"V750出厂价改成120"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    recipeName: { type: 'string', description: '要修改的配方名称' },
                    qty: { type: 'number', description: '新数量（可选）' },
                    unitPrice: { type: 'number', description: '新出厂价（可选）' },
                    profitMargin: { type: 'number', description: '新利润率倍数如1.15（可选）' }
                },
                required: ['orderId', 'recipeName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generate_purchase_list',
            description: '为订单生成采购清单和采购TODO。自动汇总所有配方零件需求、扣减库存、按供应商分组。当用户说"生成订单5的采购清单"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' }
                },
                required: ['orderId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_order',
            description: '彻底删除一个订单。当用户说"删掉订单5"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '要删除的订单ID' }
                },
                required: ['orderId']
            }
        }
    },
    // ── 第二组：配方管理 ──
    {
        type: 'function',
        function: {
            name: 'create_recipe',
            description: '新建配方。当用户说"新建配方XX"时使用。零件可用简化格式如 [{model:"201轴承",qty:2}]，后端会自动匹配完整信息',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '配方名称' },
                    spec: { type: 'string', description: '规格（如1寸、1.5寸）' },
                    parts: {
                        type: 'array',
                        description: '零件列表',
                        items: {
                            type: 'object',
                            properties: {
                                model: { type: 'string', description: '零件型号' },
                                qty: { type: 'number', description: '数量' }
                            },
                            required: ['model', 'qty']
                        }
                    }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_recipe',
            description: '删除配方。当用户说"删掉配方XX"时使用',
            parameters: {
                type: 'object',
                properties: {
                    recipeName: { type: 'string', description: '要删除的配方名称' }
                },
                required: ['recipeName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_recipe',
            description: '修改配方信息（名称、规格、增减零件）。当用户说"把V750配方里的XX换成YY"或"给V750配方加个零件"时使用',
            parameters: {
                type: 'object',
                properties: {
                    recipeName: { type: 'string', description: '要修改的配方名称（用于查找）' },
                    newName: { type: 'string', description: '新名称（可选）' },
                    newSpec: { type: 'string', description: '新规格（可选）' },
                    addParts: {
                        type: 'array',
                        description: '要添加的零件（可选）',
                        items: {
                            type: 'object',
                            properties: { model: { type: 'string' }, qty: { type: 'number' } },
                            required: ['model', 'qty']
                        }
                    },
                    removeParts: {
                        type: 'array',
                        description: '要移除的零件型号列表（可选）',
                        items: { type: 'string' }
                    },
                    updateParts: {
                        type: 'array',
                        description: '要修改数量的零件（可选）',
                        items: {
                            type: 'object',
                            properties: { model: { type: 'string' }, qty: { type: 'number' } },
                            required: ['model', 'qty']
                        }
                    }
                },
                required: ['recipeName']
            }
        }
    },
    // ── 第二组补充：AI 业务编排草稿工具（不直接写库） ──
    {
        type: 'function',
        function: {
            name: 'build_recipe_bom_draft',
            description: '生成配方 BOM 草稿，不写库。适合用户给出泵壳模板/型号变体、线圈规格片数、机筒长度、浮球、电缆等参数时，先让系统按标准规则生成泵壳、长螺丝、线圈、电容、电缆等联动项目。',
            parameters: {
                type: 'object',
                properties: {
                    templateId: { type: 'number', description: '泵壳模板ID，可选' },
                    modelVariantId: { type: 'number', description: '型号变体ID，可选' },
                    customBarrelLength: { type: 'number', description: '机筒长度 mm，可触发不锈钢泵壳整体价和长螺丝联动' },
                    longScrewExtraLength: { type: 'number', description: '长螺丝补偿长度 mm，可选' },
                    coilSpec: { type: 'string', description: '线圈规格，如12' },
                    coilSheets: { type: 'number', description: '线圈片数，如140' },
                    coilMaterial: { type: 'string', description: '线圈材质，可选' },
                    coilSlotType: { type: 'string', enum: ['小眼', '国标眼'], description: '定子槽眼，可选，默认小眼' },
                    coilWireWeight: { type: 'number', description: '客户指定线重，可选' },
                    hasFloat: { type: 'boolean', description: '是否带浮球' },
                    floatWire: { type: 'string', description: '浮球线径，可选' },
                    floatAccessoryType: { type: 'string', enum: ['standard', 'xinjie'], description: '浮球铜套规格' },
                    hasCable: { type: 'boolean', description: '是否带电缆' },
                    cableLength: { type: 'number', description: '电缆长度，米' },
                    cableWire: { type: 'string', description: '电缆线径，可选' },
                    cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'], description: '电缆铜套规格' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'preview_recipe_cost',
            description: '基于已有配方做动态成本试算，不写库。适合用户问“某配方在180mm机筒/140片/带浮球时总成本是多少”。如果只问泵壳本身成本，用 preview_pump_shell_cost。',
            parameters: {
                type: 'object',
                properties: {
                    recipeId: { type: 'number', description: '配方ID，优先使用' },
                    recipeName: { type: 'string', description: '配方名称，未提供ID时用于查找' },
                    overrides: { type: 'object', description: '标准覆盖项对象，可包含 customBarrelLength/coilSheets/hasFloat/cableLength 等' },
                    customBarrelLength: { type: 'number' },
                    coilSheets: { type: 'number' },
                    coilWireWeight: { type: 'number' },
                    hasFloat: { type: 'boolean' },
                    floatWire: { type: 'string' },
                    floatAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] },
                    hasCable: { type: 'boolean' },
                    cableLength: { type: 'number' },
                    cableWire: { type: 'string' },
                    cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'preview_pump_shell_cost',
            description: '计算泵壳模板在指定机筒长度下的泵壳本体成本，不写库。用户问“V750 180mm机筒泵壳成本”“180mm机筒高度时泵壳多少钱”“不锈钢机筒加长后泵壳成本”时使用。会触发不锈钢机筒整体泵壳随长度加价规则；未提供泵壳型号时应先追问型号。',
            parameters: {
                type: 'object',
                properties: {
                    shellModel: { type: 'string', description: '泵壳型号/模板名称，如 V750。必填，除非已能从上下文明确确定。' },
                    templateId: { type: 'number', description: '泵壳模板ID，可选；优先于 shellModel' },
                    customBarrelLength: { type: 'number', description: '机筒长度/高度，单位 mm，如 180' }
                },
                required: ['customBarrelLength']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'build_quotation_draft',
            description: '生成客户报价保存草稿，不写库。适合 AI 先试算成本后，为客户组装报价明细，确认后再调用正式写操作。',
            parameters: {
                type: 'object',
                properties: {
                    customerName: { type: 'string', description: '客户名称' },
                    customerId: { type: 'number', description: '客户ID，可选' },
                    status: { type: 'string', description: '报价状态，默认报价中' },
                    margin: { type: 'number', description: '默认利润率倍数，如1.1' },
                    remark: { type: 'string', description: '备注' },
                    items: {
                        type: 'array',
                        description: '报价明细',
                        items: {
                            type: 'object',
                            properties: {
                                recipeId: { type: 'number' },
                                recipeName: { type: 'string' },
                                qty: { type: 'number' },
                                unitCost: { type: 'number' },
                                margin: { type: 'number' },
                                unitPrice: { type: 'number' },
                                overrides: { type: 'object', description: '成本覆盖项，不传 unitCost 时可用于试算' }
                            }
                        }
                    }
                },
                required: ['items']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'build_order_draft',
            description: '生成订单保存草稿，不写库。适合用户确认报价或产品明细后，先预览订单、采购清单和待办。',
            parameters: {
                type: 'object',
                properties: {
                    customerName: { type: 'string' },
                    contractNo: { type: 'string' },
                    remark: { type: 'string' },
                    status: { type: 'string' },
                    items: { type: 'array', description: '订单产品明细，结构同订单保存草稿' },
                    purchaseList: { type: 'array' },
                    todos: { type: 'array' }
                },
                required: ['customerName', 'items']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_customer_history',
            description: '查询客户历史报价和订单，不写库。适合报价前查看同客户、同型号或相近产品的历史价格。',
            parameters: {
                type: 'object',
                properties: {
                    customerName: { type: 'string', description: '客户名称' },
                    customerId: { type: 'number', description: '客户ID，可选' },
                    keyword: { type: 'string', description: '型号/配方关键词，可选' },
                    recipeName: { type: 'string', description: '配方名称关键词，可选' },
                    model: { type: 'string', description: '型号关键词，可选' },
                    limit: { type: 'number', description: '最多返回条数' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'explain_cost_change',
            description: '解释两个配方之间的成本差异，不写库。适合用户问“为什么12-140比12-120贵”“两个型号贵在哪里”。返回总差额和主要差异驱动项。',
            parameters: {
                type: 'object',
                properties: {
                    leftRecipeId: { type: 'number', description: '基准配方ID' },
                    leftRecipeName: { type: 'string', description: '基准配方名称' },
                    rightRecipeId: { type: 'number', description: '对比配方ID' },
                    rightRecipeName: { type: 'string', description: '对比配方名称' },
                    recipe1: { type: 'string', description: '基准配方名称兼容字段' },
                    recipe2: { type: 'string', description: '对比配方名称兼容字段' },
                    limit: { type: 'number', description: '返回差异项数量' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_data_quality_summary',
            description: '获取数据质量报告，不写库。适合用户问“系统资料还有什么问题”“AI 准确性风险在哪里”“基础数据健康度”。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'analyze_recipe_configuration',
            description: '分析某个配方的相似配方、确定性漏项、同类高频项和固定件价格异常，不写库。适合用户问“这个配方有没有漏东西”“价格是否合理”“找相近配方”“帮我检查配置”。结果是带证据的复核建议，禁止描述为自动判定或自动修改。',
            parameters: {
                type: 'object',
                properties: {
                    recipeId: { type: 'number', description: '配方ID，优先使用' },
                    recipeName: { type: 'string', description: '配方完整名称，未提供ID时使用' },
                    limit: { type: 'number', description: '最多比较的相似配方数量，默认5，最大8' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_recipe_analysis_feedback',
            description: '保存用户对配方智能检查某条提醒的判断。仅在用户明确要求确认问题、忽略提醒、标记特殊情况或恢复复核时使用，写库前必须确认。findingKey 必须来自最近一次 analyze_recipe_configuration 的结果，不得自行编造。',
            parameters: {
                type: 'object',
                properties: {
                    recipeId: { type: 'number', description: '配方ID' },
                    findingKey: { type: 'string', description: '智能检查返回的精确 finding key' },
                    findingType: { type: 'string', description: '智能检查返回的提醒类型' },
                    decision: { type: 'string', enum: ['confirmed', 'ignored', 'special_case', 'review'], description: '确认问题、忽略、特殊情况或恢复复核' },
                    note: { type: 'string', description: '用户说明，可选，最多500字' },
                    findingSnapshot: { type: 'object', description: '本次提醒摘要，可选' }
                },
                required: ['recipeId', 'findingKey', 'findingType', 'decision']
            }
        }
      },
      {
          type: 'function',
          function: {
              name: 'get_factory_learning_health',
              description: '检查配方智能检查学习反馈的健康状态，只读。覆盖所有已确认、特殊情况和忽略的同类高频项反馈，包括尚未形成候选规则的记录；区分仍有效、内容过期、模板漂移和配方已归档，并返回需要重新检查的配方。适合用户问“哪些学习反馈过期了”“哪些配方需要重新智能检查”“知识学习证据是否健康”。',
              parameters: {
                  type: 'object',
                  properties: {
                      limit: { type: 'number', description: '返回明细条数，可选，1-200，默认100' }
                  }
              }
          }
      },
      {
          type: 'function',
          function: {
              name: 'get_factory_rule_candidates',
            description: '读取从配方检查人工反馈中归纳出的候选业务规则、确认/特殊情况/忽略/范围漂移/内容过期证据、置信度和批准门槛，只读。范围漂移表示配方已更换泵壳模板；内容过期表示配方在反馈后又被修改，这些历史证据都不会计入当前规则。适合用户问“有哪些规则待审核”“已经批准了哪些学习规则”“某条规则为什么不能批准”。',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['candidate', 'approved', 'rejected', 'stale'], description: '按审核状态过滤，可选' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_factory_rule_impact',
            description: '分析某条候选或已批准工厂规则对当前配方的实际影响，只读。返回同模板配方中已符合、需要复核、特殊情况和已忽略的数量及清单。适合在批准规则前确认影响范围，或回答“这条规则会影响哪些配方”。',
            parameters: {
                type: 'object',
                properties: {
                    candidateId: { type: 'number', description: '候选业务规则ID' }
                },
                required: ['candidateId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_factory_rule_compliance',
            description: '汇总全部已批准工厂规则的当前执行情况，只读。返回存在问题的规则、受影响配方、规则问题总数和已记录例外。适合用户问“哪些配方不符合工厂规则”“批准的规则执行得怎么样”。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_factory_rule_history',
            description: '读取工厂规则的生命周期记录，只读。可查看候选生成、证据变化、范围漂移或内容过期导致的失效、批准、批准自动撤回、驳回和重新激活的时间、状态与说明。适合回答“这条规则为什么变了”“最近规则发生了什么变化”。',
            parameters: {
                type: 'object',
                properties: {
                    candidateId: { type: 'number', description: '候选业务规则ID，可选；不传则读取最近全部规则变化' },
                    limit: { type: 'number', description: '返回条数，可选，1-100，默认30' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'restore_factory_rule_event',
            description: '把规则恢复到某条历史事件中的审核状态。只恢复候选、批准或驳回状态，保留当前规则内容和学习证据；恢复批准时会重新校验证据并自动同步规则知识。写库前必须确认。',
            parameters: {
                type: 'object',
                properties: {
                    eventId: { type: 'number', description: '要恢复的规则历史事件ID；应先用 get_factory_rule_history 查询' },
                    restoreNote: { type: 'string', description: '本次恢复说明，可选，最多500字' }
                },
                required: ['eventId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'refresh_factory_rule_candidates',
            description: '根据同类配方的确认、特殊情况和忽略反馈重新归纳候选业务规则并计算置信度。反馈绑定生成时的泵壳模板和配方版本；更换模板标为范围漂移，修改配方标为内容过期，两者都不计入规则。只生成候选项，不会自动批准；失去最低支持证据的旧规则会失效，已批准规则低于65%置信度时会自动撤回批准并移除规则知识；写库前必须确认。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'review_factory_rule_candidate',
            description: '批准、驳回或恢复某条候选业务规则。批准要求至少2个不同配方确认且置信度不低于65%；批准会自动写入对应规则知识，驳回或失效会自动移除，不需要再执行全量知识库同步；写库前必须确认。',
            parameters: {
                type: 'object',
                properties: {
                    candidateId: { type: 'number', description: '候选规则ID' },
                    status: { type: 'string', enum: ['candidate', 'approved', 'rejected'], description: '目标审核状态' },
                    reviewNote: { type: 'string', description: '审核说明，可选，最多500字' }
                },
                required: ['candidateId', 'status']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_management_action_center',
            description: '实时读取个人管理助理的今日执行队列，汇总订单准备、经营风险、数据质量、规则学习和知识健康。返回最先处理的三项、排序依据、最短处理路径和完成标准；resolution.canAiConfirm=true 时只表示可继续读取最新订单处理方案并发起确认，不得直接宣称已执行。该工具只读，不创建任务、不修改业务数据。用户问“今天先处理什么”“现在最重要的待办”“工厂有哪些风险需要优先跟进”时使用。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_business_alerts',
            description: '获取报价和订单经营异常提醒，不写库。适合用户问“现在还有哪些报价订单风险”“有什么需要跟进”“哪些订单卡住了”。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_order_readiness_overview',
            description: '实时汇总全部活动订单的生产准备情况，按数据阻塞、待补料、待复核、可生产分类，并返回每个订单的主要问题和下一步。只读，不修改订单、采购和库存。用户问“哪些订单不能生产”“所有订单准备情况”“目前有多少订单缺料”时使用。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'check_order_readiness',
            description: '实时检查一个订单当前能否进入生产。按顺序核对订单状态、配方与BOM快照、零件库存、线圈库存、采购进度、锁定成本和出厂价，返回可生产、待补料、待复核、数据阻塞或不适用。只读，不修改订单和库存。用户问“这个订单能不能生产”“是否齐料”“还缺什么”“生产准备情况”时使用。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID，已知时优先使用' },
                    orderQuery: { type: 'string', description: '订单ID未知时可传客户名或合同号；匹配多条时会要求用户明确' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'plan_order_readiness_actions',
            description: '根据订单实时生产准备检查结果生成按依赖排序的处理方案。区分AI可发起确认、人工补资料、采购跟进和等待状态；本工具只生成方案，不执行写操作。用户问“这个订单的问题怎么处理”“给出处理方案”“下一步做什么”时使用。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID，已知时优先使用' },
                    orderQuery: { type: 'string', description: '订单ID未知时可传客户名或合同号；匹配多条时会要求用户明确' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'execute_order_readiness_action',
            description: '执行订单处理方案中当前已解锁的AI可确认步骤。只能在本轮先读取 plan_order_readiness_actions、用户明确要求执行具体步骤后调用；调用后仍会显示确认卡片，用户确认时后端重新校验实时方案。人工、等待或有前置阻塞的步骤不能执行。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '当前处理方案中的订单ID' },
                    actionId: {
                        type: 'string',
                        enum: ['confirm_order', 'generate_purchase_plan'],
                        description: '当前处理方案中 status=available 且 mode=confirmable 的步骤ID'
                    }
                },
                required: ['orderId', 'actionId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_factory_knowledge',
            description: '使用精确关键词和语义表达统一搜索工厂知识库，覆盖零件、模板、配方、配方性能测试报告、线圈、客户、报价、订单、质量问题、业务规则和独立工厂资料。结果 evidenceLevel=semantic_candidate 或 matchMode=vector 只表示语义候选，不能单独证明用途、兼容性或专用配件关系；必须由标题、摘要、正文或 metadata 的明确文字证实后才能下结论。配方结果中的 Excel 是性能测试报告附件，不是图纸。查询“12-220”这类线圈键时传 entryType=coil，会返回所有材质和槽眼方案的完整详情。独立资料使用 entryType=document；parserStatus=metadata_only 表示只能使用标题、说明和标签，不得推断文件正文。只读。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '搜索关键词' },
                    entryType: { type: 'string', enum: ['part', 'template', 'recipe', 'coil', 'customer', 'quotation', 'order', 'quality_issue', 'business_rule', 'document'], description: '知识类型过滤，可选' },
                    sourceTable: { type: 'string', description: '来源表过滤，可选' },
                    limit: { type: 'number', description: '最多返回条数，默认10，最大50' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_factory_knowledge_detail',
            description: '读取某条工厂知识库条目的完整内容。通常先用 search_factory_knowledge 找到 id，再调用本工具。配方中的 .xls/.xlsx 附件若标记为 pump_performance_test，必须称为性能测试报告，不是图纸。独立资料 metadata.parserStatus=metadata_only 时只能说明文件存在及其人工填写信息，不能推断文件正文。',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: '知识条目ID' }
                },
                required: ['id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_factory_knowledge_health',
            description: '实时检查工厂知识库自动同步是否正常，返回健康级别、待同步数量、异常原因、最近同步记录以及是否建议人工恢复。适合用户问“知识库正常吗”“最近同步成功了吗”“为什么同步失败”“是否需要手动同步”。只读，不执行同步。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'sync_factory_knowledge',
            description: '把当前系统里的零件、模板、配方、线圈、客户、报价、订单、质量问题和业务规则增量同步成工厂知识条目，并刷新 SQLite FTS 索引。需要用户确认后执行。',
            parameters: { type: 'object', properties: {} }
        }
    },
    // ── 第三组：数据分析与辅助 ──
    {
        type: 'function',
        function: {
            name: 'compare_recipes',
            description: '对比两个配方的BOM和成本差异。当用户说"对比V750和V550"时使用',
            parameters: {
                type: 'object',
                properties: {
                    recipe1: { type: 'string', description: '配方1名称' },
                    recipe2: { type: 'string', description: '配方2名称' }
                },
                required: ['recipe1', 'recipe2']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_parts',
            description: '按关键词或类别搜索零件。当用户说"找所有密封件""有没有叫XX的零件"时使用',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: '搜索关键词（模糊匹配型号/名称）' },
                    category: { type: 'string', description: '按类别筛选（可选）' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_part',
            description: '删除一个零件。当用户说"删掉零件XX"时使用',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '要删除的零件型号' }
                },
                required: ['model']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'batch_update_prices',
            description: '按类别批量调整零件价格。当用户说"把所有轴承涨价10%""密封件统一降2元"时使用',
            parameters: {
                type: 'object',
                properties: {
                    category: { type: 'string', description: '零件类别' },
                    percentChange: { type: 'number', description: '百分比变化（如10表示涨10%，-5表示降5%）' },
                    absoluteChange: { type: 'number', description: '绝对值变化（如2表示涨2元，-1表示降1元），与percentChange二选一' }
                },
                required: ['category']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_dashboard_summary',
            description: '获取运营数据汇总（订单统计、配方数量、零件数量、成本/利润、今日工作台、待采购供应商关注等）。当用户说"最近的运营数据""系统概况""今天该处理什么""待采购任务"时使用',
            parameters: { type: 'object', properties: {} }
        }
    },
    // ── 第四组：转子出图与打印 ──
    {
        type: 'function',
        function: {
            name: 'generate_rotor_drawing',
            description: '生成转子图纸PDF。当用户提到"出图""转子图""画一张图"时使用。可以传泵壳型号(shell_model)自动获取所有默认参数（轴承、油封、开档、定位等），只需补充片数和用户明确提供的尺寸即可。没有提供的参数由模板补全，不要反复追问用户。出图大约15-30秒。',
            parameters: {
                type: 'object',
                properties: {
                    shell_model: { type: 'string', description: '泵壳型号（如V750）。传此字段后系统会自动提取模板中的所有默认参数：上下轴承、油封孔径、开档、定位等，用户不需要再提供这些参数' },
                    upper_bearing: { type: 'string', description: '上轴承型号。如传了shell_model则自动从模板获取，不需要手动填' },
                    lower_bearing: { type: 'string', description: '下轴承型号。如传了shell_model则自动从模板获取' },
                    piece_count: { type: 'number', description: '转子片数（如160）' },
                    bearing_span: { type: 'number', description: '开档/轴承间距（mm）。如传了shell_model则自动从模板获取' },
                    stack_offset: { type: 'number', description: '定位/叠片偏移（mm）。如传了shell_model则自动从模板获取' },
                    oil_seal_dia: { type: 'number', description: '油封直径（mm）。如传了shell_model则自动从模板获取' },
                    impeller_dia: { type: 'number', description: '叶轮直径（mm）' },
                    impeller_depth: { type: 'number', description: '叶轮厚度（mm）' },
                    bearing_to_impeller: { type: 'number', description: '叶轮开档（mm）' },
                    thread_dia: { type: 'number', description: '螺纹直径（mm）' },
                    thread_length: { type: 'number', description: '螺纹长度（mm）' }
                },
                required: ['piece_count']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'print_rotor_drawing',
            description: '打印已生成的转子图纸。当用户说"帮我打印图纸""打印上一张图"时使用。需要提供jobId（可从出图历史获取）',
            parameters: {
                type: 'object',
                properties: {
                    jobId: { type: 'string', description: '出图任务的jobId' }
                },
                required: ['jobId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_rotor_drawing_history',
            description: '获取转子出图历史记录。当用户说"看看出图记录""最近出的图""上一张图的jobId"时使用',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: '返回的记录数量，默认10' }
                }
            }
        }
    }
];

// ── 写操作工具白名单（需要 allowWrite=true 才能执行） ──
const WRITE_TOOLS = new Set([
    'create_part', 'update_part', 'delete_part', 'batch_update_prices',
    'create_order', 'delete_order', 'update_order_status',
    'add_recipe_to_order', 'remove_recipe_from_order', 'update_order_item',
    'generate_purchase_list',
    'execute_order_readiness_action',
    'create_recipe', 'delete_recipe', 'update_recipe',
    'sync_factory_knowledge',
    'set_recipe_analysis_feedback',
    'refresh_factory_rule_candidates',
    'review_factory_rule_candidate',
    'restore_factory_rule_event',
]);


module.exports = { AI_TOOLS, WRITE_TOOLS };
