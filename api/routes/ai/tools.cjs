const COST_OVERRIDE_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        coilId: { type: 'integer', minimum: 1 },
        coilSchemeFamilyCode: { type: 'string' },
        surfaceTreatmentMode: { type: 'string' },
        surfaceTreatmentCost: { type: 'number', minimum: 0 },
        hasFloat: { type: 'boolean' },
        floatWire: { type: 'string' },
        floatAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] },
        hasCable: { type: 'boolean' },
        cableLength: { type: 'number', minimum: 0 },
        cableWire: { type: 'string' },
        cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'] },
        coilSpec: { type: 'string' },
        coilSheets: { type: 'number', minimum: 0 },
        coilMaterial: { type: 'string' },
        coilSlotType: { type: 'string' },
        customBarrelLength: { type: 'number', minimum: 0 },
        boxType: { type: 'string' },
        packingPartsJson: { type: 'string' },
        extraPartsJson: { type: 'string' },
    },
});

const AI_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'full_calculate',
            description: '已有正式配方的兼容成本试算。只接受配方ID或可唯一匹配的完整配方名；配方内已有的线圈、浮球、电缆和包装会按角色替换而不是重复相加。用户给出泵壳模板和临时配置（线圈、浮球、木箱、珍珠棉等）时必须使用 build_recipe_bom_draft。',
            parameters: {
                type: 'object',
                properties: {
                    recipeId: { type: 'integer', minimum: 1, description: '正式配方ID，已知时优先使用' },
                    recipeName: { type: 'string', description: '正式成品型号或可唯一匹配的名称片段；不是泵壳模板名' },
                    pumphousing_model: { type: 'string', description: '兼容字段：实际含义为成品型号片段，已废弃；泵壳模板应使用 preview_pump_shell_cost' },
                    stator: { type: 'string', description: '定子规格-片数，如"12-120"' },
                    hasFloat: { type: 'boolean', description: '是否带浮球' },
                    cableLength: { type: 'number', description: '电缆长度（米）' },
                    boxType: { type: 'string', description: '包装类型' },
                    floatWire: { type: 'string', description: '浮球线径（可选）' },
                    cableWire: { type: 'string', description: '电缆横截面积，单位 mm²，例如0.55（可选）' },
                    cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'], description: '铜套规格：普通铜套 standard，新界式 xinjie' },
                    packingPartsJson: { type: 'string', description: '包装零件 JSON 数组；覆盖配方原包装，不与原包装重复相加' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['recipeId'] },
                    { type: 'object', properties: {}, required: ['recipeName'] },
                    { type: 'object', properties: {}, required: ['pumphousing_model'] },
                ]
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_copper_price',
            description: '读取每日铜价快照（元/吨、元/千克），以 asOf 标明行情时间，stale=true 表示非今日行情，不冒充实时行情',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculate_coil_cost',
            description: '计算一个指定线圈方案的成本，支持自定义线重和插值。权威职责是 Calculation/Preview，不负责列出数据库中的全部已登记方案或实时库存；用户要求“全部方案、全部正式方案、有哪些方案、库存”时必须使用 search_coils。材质或槽眼不明确且会影响计算时，不得默认选择，应让用户确认或先用 search_coils 读取候选。',
            parameters: {
                type: 'object',
                properties: {
                    spec: { type: 'string', description: '定子规格' },
                    coilId: { type: 'integer', minimum: 1, description: '具体正式线圈方案 ID；同组合有多套方案时优先使用' },
                    schemeCode: { type: 'string', description: '稳定方案编码；可替代 coilId 精确指定方案' },
                    schemeFamilyCode: { type: 'string', description: '插值时限定同一设计族' },
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
            name: 'search_coils',
            description: '从正式线圈 API 列出全部已登记线圈/定子成品方案、实时库存和完整档案。它是“全部方案、全部正式方案、有哪些方案、材质槽眼、成本库存、默认电容/搭配电缆横截面积、主副线漆包线线径和绕组数据”的权威 List/Query 能力，可按规格、片数、材质、槽眼、方案编码、状态、默认标记、电压、频率、市场和方案族筛选；schemeStatus 明确区分正式、测试和停用方案。单个指定方案的插值或自定义线重试算才使用 calculate_coil_cost；不得用知识快照代替当前线圈档案。',
            parameters: {
                type: 'object',
                properties: {
                    spec: { type: 'string', description: '定子规格（俗称），如“150”。用户说“12-120”时表示规格俗称12、片数120，可整体传入 spec，服务端会自动拆分' },
                    sheets: { type: 'integer', description: '片数，如“96”' },
                    material: { type: 'string', description: '材质（可选）' },
                    slotType: { type: 'string', description: '槽眼（可选）' },
                    schemeCode: { type: 'string', description: '稳定方案编码（可选）' },
                    schemeStatus: { type: 'string', enum: ['official', 'testing', 'disabled'], description: '方案状态（可选）' },
                    isDefault: { type: 'boolean', description: '是否为同组合的默认方案（可选）' },
                    ratedVoltageV: { type: 'integer', minimum: 1, description: '额定电压，单位 V（可选）' },
                    ratedFrequencyHz: { type: 'integer', minimum: 1, description: '额定频率，单位 Hz（可选）' },
                    market: { type: 'string', description: '适用市场（可选）' },
                    schemeFamilyCode: { type: 'string', description: '方案族编码，用于限定同一电气设计族（可选）' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'adjust_coil_stock',
            description: '批量调整线圈/定子成品库存。用户说“12-120”时表示规格俗称12、片数120，不是零件型号；入库传正数，出库传负数。同一简写存在多个正式材质或槽眼方案时必须先让用户明确，禁止默认选择。',
            parameters: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        description: '要调整的线圈成品库存',
                        minItems: 1,
                        maxItems: 50,
                        items: {
                            type: 'object',
                            properties: {
                                model: { type: 'string', minLength: 1, description: '规格俗称-片数，如“12-120”' },
                                schemeCode: { type: 'string', description: '稳定方案编码；同组合有多套正式方案时必须提供' },
                                changeQty: {
                                    type: 'integer',
                                    anyOf: [
                                        { type: 'integer', maximum: -1 },
                                        { type: 'integer', minimum: 1 },
                                    ],
                                    description: '库存变动套数；入库为正数，出库为负数，不能为0',
                                },
                                material: { type: 'string', enum: ['钢带', '冷轧'], description: '材质（可选；存在多个方案时必填）' },
                                slotType: { type: 'string', enum: ['小眼', '国标眼'], description: '槽眼（可选；存在多个方案时必填）' }
                            },
                            required: ['model', 'changeQty']
                        }
                    },
                    note: { type: 'string', description: '库存调整备注（可选）' }
                },
                required: ['items']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'adjust_part_stock',
            description: '批量调整零件库库存。按零件型号精确定位，多型号必须放在同一次原子批量调整中；入库传正数，出库传负数。只用于零件库，不用于“规格-片数”线圈成品。',
            parameters: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        description: '要调整的零件库存，最多100项',
                        minItems: 1,
                        maxItems: 100,
                        items: {
                            type: 'object',
                            properties: {
                                model: { type: 'string', minLength: 1, description: '零件库中的精确型号' },
                                changeQty: {
                                    type: 'integer',
                                    anyOf: [
                                        { type: 'integer', maximum: -1 },
                                        { type: 'integer', minimum: 1 },
                                    ],
                                    description: '库存变动件数；入库为正数，出库为负数，不能为0',
                                }
                            },
                            required: ['model', 'changeQty']
                        }
                    },
                    note: { type: 'string', description: '库存调整备注（可选）' }
                },
                required: ['items']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_all_recipes',
            description: '从正式配方 API 获取成品型号列表，可按成品型号或配置摘要筛选。名称类型尚不确定时，可以与线圈、零件、模板目录组合查证；明确物料查询优先 search_parts，不能把相似配方自动替代用户目标。用户询问哪些配方有测试报告或有报告的配方数量时，设置 hasTechnicalFiles=true。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: '成品型号或配置摘要关键词（可选）' },
                    hasTechnicalFiles: { type: 'boolean', description: '是否只返回至少关联一份有效技术档案或测试报告的配方' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_recipe_detail',
            description: '读取指定配方的正式明细和 BOM；需要当前完整成本时设置 includeCurrentCost=true，结果以 currentCost.currentTotalCost 和 costBasis=currentFullCost 返回。currentCost.unitCost 仅为一个兼容周期的废弃别名。按配方ID、名称或可唯一匹配的简称定位，名称匹配忽略大小写；多条命中时停止并返回候选。只读，不使用保存成本或覆盖试算冒充当前成本。',
            parameters: {
                type: 'object',
                properties: {
                    recipeId: { type: 'integer', minimum: 1, description: '配方ID，优先使用' },
                    recipeName: { type: 'string', description: '成品型号或可唯一匹配的简称，未提供ID时用于匹配' },
                    includeCurrentCost: { type: 'boolean', description: '是否同时查询当前完整成本' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['recipeId'] },
                    { type: 'object', properties: {}, required: ['recipeName'] },
                ]
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_recipe_technical_files',
            description: '读取指定配方的正式技术档案和性能测试报告数据。按配方ID或名称定位后调用正式配方技术档案 API；files[].testCurve 返回逐点流量、扬程、电流、效率，以及服务端确定性计算的 maxHead、maxFlow、maxCurrent、maxUnitEfficiency 和对应测试点。associationWarnings 会提示报告内部型号与关联配方不一致，回答时应明确提醒核实归属，但不否定报告已关联的事实。回答最高扬程、最大流量、最大电流或最高效率时必须直接使用这些正式统计，不得让模型自行挑选极值。只读，不上传、修改或删除文件。',
            parameters: {
                type: 'object',
                properties: {
                    recipeId: { type: 'integer', minimum: 1, description: '配方ID，优先使用' },
                    recipeName: { type: 'string', description: '成品型号或可唯一匹配的简称，未提供ID时用于匹配' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['recipeId'] },
                    { type: 'object', properties: {}, required: ['recipeName'] },
                ]
            }
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
            description: '读取正式订单列表。“订单、单子、单据”都指订单；“采购中的单子/单据”必须调用本工具并传 status=采购中。用户明确状态、客户或合同号时必须把条件传入，不得读取全量后由模型二次筛选。具名客户或合同号模糊筛选若唯一命中一张订单，服务端会自动伴随读取该订单知识包；多条命中不会猜选。',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回数量；仅用户明确“最近/前N个”时传入' },
                    status: {
                        type: 'string',
                        enum: ['待确认', '待采购', '采购中', '采购完成', '已关闭', '已取消'],
                        description: '订单状态精确筛选（可选）'
                    },
                    customerName: { type: 'string', description: '客户名称模糊筛选（可选）' },
                    contractNo: { type: 'string', description: '合同号模糊筛选（可选）' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_part',
            description: '新建/录入单个零件到数据库。仅用于一条零件；两条及以上必须使用 batch_create_parts',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '型号/名称' },
                    category: { type: 'string', description: '类别（如 轴承、螺丝、密封件、电容 等），默认"其他"' },
                    subcategory: { type: 'string', description: '包装二级分类：外包装、内衬或固定包材；仅 category=包装 时使用' },
                    price: { type: 'number', description: '目录成本价（元）' },
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
            name: 'batch_create_parts',
            description: '批量新增/录入零件到数据库。适用于价格表、图片识别结果或用户一次提供两条及以上零件；同型号但供应商不同允许分别建档，同型号同供应商的现有零件会在正式预览中跳过。调用后必须显示一次整批确认卡片',
            parameters: {
                type: 'object',
                properties: {
                    parts: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 100,
                        description: '待新增零件，必须完整保留用户确认的型号、目录成本价、供应商和库存',
                        items: {
                            type: 'object',
                            properties: {
                                model: { type: 'string', description: '型号/名称' },
                                category: { type: 'string', description: '类别，默认其他' },
                                subcategory: { type: 'string', description: '包装二级分类，仅 category=包装 时使用' },
                                price: { type: 'number', description: '目录成本价（元）' },
                                supplier: { type: 'string', description: '供应商，默认-' },
                                stock: { type: 'number', description: '初始库存，默认0' },
                                remark: { type: 'string', description: '备注（可选）' }
                            },
                            required: ['model', 'price']
                        }
                    }
                },
                required: ['parts']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_quotations',
            description: '读取正式报价列表及每条命中报价的完整正式字段，权威职责是按报价状态、客户名称等条件筛选当前报价。状态查询必须传 status，API 只返回命中项，禁止先查全部再由模型筛选。需要稳定读取一份指定报价时使用 get_quotation_detail；若目标是某一个具名客户的全部报价、历史报价或报价与订单历史，应使用 search_customer_history，以区分客户不存在与客户存在但没有报价。',
            parameters: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['草稿', '报价中', '已接受', '已拒绝', '已转订单', '已过时'],
                        description: '报价状态精确筛选（可选）'
                    },
                    customerName: {
                        type: 'string',
                        description: '客户名称模糊筛选（可选）'
                    },
                    limit: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 100,
                        description: '最多返回数量；仅用户明确“最近/前N个”时传入'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_quotation_detail',
            description: '按报价ID读取一份正式报价的完整详情，包括客户、状态、全部报价明细、成本售价、备注、转换订单信息和时间字段。只读，不修改报价；ID必须来自用户明确输入、当前报价页面或 search_quotations 的正式结果。',
            parameters: {
                type: 'object',
                properties: {
                    quotationId: { type: 'integer', minimum: 1, description: '正式报价ID' }
                },
                required: ['quotationId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_customers',
            description: '读取正式客户列表，可按客户名称筛选。查询客户列表时使用，不得退回知识库。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '客户名称模糊筛选（可选）' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回数量（可选）' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_templates',
            description: '读取正式泵壳模板列表及每条命中模板的完整正式字段，可按泵壳型号或描述筛选。结果包括 BOM、泵壳组件、转子参数、工资、表面处理和套件成本等档案；稳定读取一个指定模板时使用 get_template_detail。查询模板时使用，不得当作零件搜索。',
            parameters: {
                type: 'object',
                properties: {
                    shellModel: { type: 'string', description: '泵壳型号关键词筛选（可选，空白分隔多个词且全部匹配，不区分大小写）' },
                    description: { type: 'string', description: '模板描述模糊筛选（可选）' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回数量（可选）' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_template_detail',
            description: '按模板ID或泵壳型号读取一个正式泵壳模板的完整档案，包括 BOM、泵壳组件、转子参数、工资、表面处理、成本模式、套件成本和备注。只读，不修改模板；名称多匹配时返回候选，不猜选。',
            parameters: {
                type: 'object',
                properties: {
                    templateId: { type: 'integer', minimum: 1, description: '正式模板ID，优先使用' },
                    shellModel: { type: 'string', description: '泵壳型号，未提供ID时用于唯一匹配' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['templateId'] },
                    { type: 'object', properties: {}, required: ['shellModel'] }
                ]
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_purchase_overview',
            description: '读取当前全部活动订单的采购任务总览，返回供应商、物料、计划/已下单/已到货/已入库/待采购数量及关联订单。仅当用户询问采购任务、供应商、采购物料、待采购数量或采购进度时使用；“采购中的订单/单子/单据有几个”属于订单状态查询，禁止使用本工具。只读，不修改采购、订单或库存。',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回的采购任务数量（可选）' },
                    supplier: { type: 'string', description: '供应商名称模糊筛选（可选）' },
                    pendingOnly: { type: 'boolean', description: '仅返回待采购数量大于0的任务（可选）' }
                }
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
                                recipeName: { type: 'string', description: '成品型号（尽量精确）' },
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
                    recipeName: { type: 'string', description: '要添加的成品型号或泵壳型号' },
                    qty: { type: 'number', description: '数量' },
                    reason: { type: 'string', minLength: 1, maxLength: 500, description: '客户或业务提出本次修改的原因；必须来自用户，不得由 AI 自动编造' }
                },
                required: ['orderId', 'recipeName', 'qty', 'reason']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_part',
            description: '只修改一个零件的资料字段（价格、供应商、类别、包装二级分类），不修改库存。库存增减统一使用 adjust_part_stock，禁止通过本工具提交 stock 或 stockDelta。',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '要修改的零件型号/名称（用于查找）' },
                    price: { type: 'number', description: '新的目录成本价（可选）' },
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
            description: '读取某个订单的实时业务详情（配方列表、采购清单、待办、金额和状态）。用户明确提供订单ID时传 orderId；只提供客户名或合同号时必须传 orderQuery，由正式订单查询唯一解析。若当前问题还涉及人工确认的客户要求、执行档案、历史异常或来源文件，服务端会在本能力成功后按同一订单目标自动补充知识包；模型不要改调其他能力或重复调用。禁止根据名称、消息序号或历史回答猜测订单ID。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'integer', minimum: 1, description: '用户明确提供或当前订单页面上下文中的订单ID' },
                    orderQuery: { type: 'string', minLength: 1, maxLength: 120, description: '订单ID未知时的客户名称或合同号' }
                },
                oneOf: [
                    { type: 'object', properties: {}, required: ['orderId'] },
                    { type: 'object', properties: {}, required: ['orderQuery'] },
                ]
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
                    reason: { type: 'string', description: '取消订单时必填原因' },
                    inventoryDisposition: {
                        type: 'string',
                        enum: ['order_outbound_deducted', 'reservation_released'],
                        description: '关闭订单时必填：按订单冻结 BOM 自动领用扣库，或明确释放库存预留'
                    },
                    inventoryDispositionNote: {
                        type: 'string',
                        description: '释放库存预留时必填原因；自动领用扣库时可补充说明'
                    }
                },
                required: ['orderId', 'status']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'remove_recipe_from_order',
            description: '从订单中精确移除一个产品明细。必须使用订单详情返回的 orderItemId；recipeName 仅可作为身份交叉核对',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    orderItemId: { type: 'string', minLength: 1, description: '订单产品明细的稳定 ID（推荐）' },
                    recipeName: { type: 'string', minLength: 1, description: '可选身份交叉核对：完整成品型号；必须与 orderItemId 指向的明细一致' },
                    reason: { type: 'string', minLength: 1, maxLength: 500, description: '客户或业务提出本次修改的原因；必须来自用户，不得由 AI 自动编造' }
                },
                required: ['orderId', 'orderItemId', 'reason']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_order_item',
            description: '精确修改订单中一个产品明细的数量或销售单价。必须使用订单详情返回的 orderItemId；recipeName 仅可作为身份交叉核对',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    orderItemId: { type: 'string', minLength: 1, description: '订单产品明细的稳定 ID（推荐）' },
                    recipeName: { type: 'string', minLength: 1, description: '可选身份交叉核对：完整成品型号；必须与 orderItemId 指向的明细一致' },
                    qty: { type: 'number', description: '新数量（可选）' },
                    unitPrice: { type: 'number', description: '新销售单价（可选）' },
                    profitMargin: { type: 'number', description: '新利润率倍数如1.15（可选）' },
                    reason: { type: 'string', minLength: 1, maxLength: 500, description: '客户或业务提出本次修改的原因；必须来自用户，不得由 AI 自动编造' }
                },
                required: ['orderId', 'orderItemId', 'reason']
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
                    orderId: { type: 'number', description: '订单ID' },
                    reason: { type: 'string', minLength: 1, maxLength: 500, description: '重新生成采购清单的业务原因；必须来自用户，不得由 AI 自动编造' }
                },
                required: ['orderId', 'reason']
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
                    name: { type: 'string', description: '成品型号（对外型号），系统名称按规格自动生成' },
                    naming: { type: 'object', additionalProperties: false, properties: { ruleId: { type: 'string', enum: ['recipe'] }, spec: { type: 'object', additionalProperties: false, properties: { series: { type: 'string' }, configuration: { type: 'string' } }, required: ['series', 'configuration'] } }, required: ['ruleId', 'spec'] },
                    coilSpec: { type: 'string', description: '定子组合代号' },
                    coilSheets: { type: 'number', description: '片数' },
                    coilId: { type: 'number', description: '具体正式线圈ID，或明确选择方案系列' },
                    coilSchemeFamilyCode: { type: 'string' },
                    coilMaterial: { type: 'string', enum: ['钢带', '冷轧'] },
                    coilSlotType: { type: 'string', enum: ['小眼', '国标眼'] },
                    customBarrelLength: { type: 'number', description: '已知机筒长度mm；未知省略' },
                    spec: { type: 'string', description: '配置摘要（如1寸、1.5寸）' },
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
                required: ['name', 'naming', 'coilSpec', 'coilSheets']
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
                    recipeName: { type: 'string', description: '要删除的成品型号' }
                },
                required: ['recipeName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_recipe',
            description: '修改配方信息（成品型号、配置摘要、增减零件）。当用户说"把V750配方里的XX换成YY"或"给V750配方加个零件"时使用',
            parameters: {
                type: 'object',
                properties: {
                    recipeName: { type: 'string', description: '要修改的成品型号（用于查找）' },
                    newName: { type: 'string', description: '新成品型号（可选）' },
                    newSpec: { type: 'string', minLength: 0, description: '新配置摘要（可选）；可传空字符串清空配置摘要。跨客户端清空时优先使用 clearSpec=true' },
                    clearSpec: { type: 'boolean', description: '设为 true 时明确清空配置摘要；不要与非空 newSpec 同时使用' },
                    addParts: {
                        type: 'array',
                        description: '要添加的零件（可选）',
                        maxItems: 15,
                        items: {
                            type: 'object',
                            properties: { model: { type: 'string' }, qty: { type: 'number' } },
                            required: ['model', 'qty']
                        }
                    },
                    removeParts: {
                        type: 'array',
                        description: '要移除的零件型号列表（可选）',
                        maxItems: 15,
                        items: { type: 'string' }
                    },
                    updateParts: {
                        type: 'array',
                        description: '要修改数量的零件（可选）',
                        maxItems: 15,
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
            description: '优先沿用已有配方的完整配置，仅覆盖用户明确给定项，按当前价格生成 BOM 并由正式成本引擎计算总成本，不写库。用户给出泵壳型号/模板、线圈规格片数、机筒长度、浮球、电缆、木箱、珍珠棉等并询问成本时优先使用；不得把泵壳模板缩写成配方名交给 full_calculate。包装和可选零件应原样传入用户说出的名称（例如“木箱”“珍珠棉”），服务端会按模板历史选择和正式零件目录解析；禁止自行翻译、缩写或生成 unknown_* 占位型号。',
            parameters: {
                type: 'object',
                properties: {
                    useRecipeBaseline: { type: 'boolean', description: '私人助理默认 true，HTTP/MCP 不传时不启用；沿用唯一匹配在售配方的完整配置，仅覆盖用户明确指定项。false 仅用于用户明确要求脱离已有配方的新配置' },
                    baseRecipeId: { type: 'integer', minimum: 1, description: '已选基准配方 ID；多个基准必须先选择。未提供时由正式服务按模板和线圈参数匹配' },
                    templateId: { type: 'number', description: '泵壳模板ID，可选' },
                    shellModel: { type: 'string', description: '完整泵壳模板型号；系统会先解析为正式 templateId' },
                    modelVariantId: { type: 'number', description: '常用配置预设编号，可选；字段名为历史兼容标识' },
                    customBarrelLength: { type: 'number', description: '机筒长度 mm，可触发不锈钢泵壳整体价和长螺丝联动' },
                    longScrewExtraLength: { type: 'number', description: '长螺丝补偿长度 mm，可选' },
                    coilId: { type: 'integer', minimum: 1, description: '本轮正式查询确认的线圈方案 ID；采用默认偏好时必须先核实唯一默认，并同时传该方案材质及槽眼' },
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
                    cableWire: { type: 'string', description: '电缆横截面积，单位 mm²，例如0.55，可选' },
                    cableAccessoryType: { type: 'string', enum: ['standard', 'xinjie'], description: '电缆铜套规格' },
                    packingParts: {
                        type: 'array',
                        maxItems: 12,
                        description: '包装项目。优先原样保留用户说出的名称；木箱、珍珠棉等可同时传入，由服务端解析正式型号。禁止生成 unknown_* 占位型号',
                        items: {
                            type: 'object',
                            properties: {
                                partId: { type: 'integer', minimum: 1 },
                                model: { type: 'string' },
                                supplier: { type: 'string' },
                                qty: { type: 'number', minimum: 0 },
                                packingRole: { type: 'string', enum: ['container', 'pearlCotton', 'foam', 'fixed'] }
                            },
                            required: ['model']
                        }
                    },
                    optionalParts: {
                        type: 'array',
                        maxItems: 20,
                        description: '其他正式零件项目',
                        items: {
                            type: 'object',
                            properties: {
                                partId: { type: 'integer', minimum: 1 },
                                model: { type: 'string' },
                                supplier: { type: 'string' },
                                qty: { type: 'number', minimum: 0 }
                            },
                            required: ['model']
                        }
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'preview_recipe_cost',
            description: '查询已有配方的当前完整参考成本，或基于该配方做动态成本试算，不写库。两种口径都以 currentTotalCost 为主成本字段，unitCost 仅为一个兼容周期的废弃别名；无覆盖参数时返回 sourceOfTruth=costEngine、costBasis=currentFullCost，有覆盖参数时返回 costBasis=overridePreview。适合用户问“V750当前成本是多少”或“某配方在180mm机筒/140片/带浮球时总成本是多少”。如果只问泵壳本身成本，用 preview_pump_shell_cost。',
            parameters: {
                type: 'object',
                properties: {
                    recipeId: { type: 'integer', minimum: 1, description: '配方ID，优先使用' },
                    recipeName: { type: 'string', description: '成品型号或可唯一匹配的简称，名称匹配忽略大小写；多条命中时返回候选' },
                    useRecipeBaseline: { type: 'boolean', description: '按已有配方完整配置和当前价格重算覆盖项；私人助理默认 true，API/MCP 省略保留报价快照覆盖兼容口径' },
                    overrides: { ...COST_OVERRIDE_SCHEMA, description: '标准成本覆盖项对象' },
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
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['recipeId'] },
                    { type: 'object', properties: {}, required: ['recipeName'] },
                ]
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
            name: 'inspect_quotation_file',
            description: '只读解析已上传的 Excel/CSV 报价文件，并用当前客户与配方数据核对字段映射。返回原表工作表/行号、客户匹配、每行配方匹配、数量、文件单价、歧义、警告和可选 quotationDraftInput；不创建客户、配方或报价。只有 readyForSaveDraft=true 才表示全部客户和配方均精确匹配，仍需调用 build_quotation_draft 重新计算正式报价草稿。',
            parameters: {
                type: 'object',
                properties: {
                    fileId: { type: 'number', description: '附件上下文中标注的统一文件ID' },
                    customerName: { type: 'string', description: '可选；文件未填写客户时用于临时匹配，不写入文件或数据库' }
                },
                required: ['fileId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_order_knowledge_package',
            description: '读取一个订单的完整只读知识包：实时订单明细、采购与待办、实时生产准备和处理方案，以及人工确认的客户要求、执行事实和来源文件。草稿不会作为正式事实返回。本工具已包含 get_order_detail、check_order_readiness 和 plan_order_readiness_actions 的核心结果，需要完整上下文时单次调用即可，不要再顺序重复调用这些工具。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'integer', minimum: 1, description: '订单ID，已知时优先使用' },
                    orderQuery: { type: 'string', description: '订单ID未知时可传客户名或合同号；匹配多条时会要求用户明确' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['orderId'] },
                    { type: 'object', properties: {}, required: ['orderQuery'] },
                ]
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
                    customerId: { type: 'integer', minimum: 1, description: '客户ID，可选' },
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
                                overrides: { ...COST_OVERRIDE_SCHEMA, description: '成本覆盖项，不传 unitCost 时可用于试算' }
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
                    items: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 100,
                        description: '订单产品明细；采购清单和待办由正式 API 生成',
                        items: {
                            type: 'object',
                            properties: {
                                recipeId: { type: 'integer', minimum: 1 },
                                recipeName: { type: 'string' },
                                spec: { type: 'string' },
                                qty: { type: 'number', minimum: 0 },
                                unitCost: { type: 'number', minimum: 0 },
                                unitPrice: { type: 'number', minimum: 0 },
                                profitMargin: { type: 'number', minimum: 0 },
                                partsJson: { type: 'string' },
                            },
                        },
                    }
                },
                required: ['customerName', 'items']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_customer_history',
            description: '按具名客户查询正式客户身份及其历史报价和订单，不写库。它是“某客户的全部报价/历史报价/历史订单”的权威能力，能区分客户不存在与客户存在但记录为零；只问报价时必须传 historyType=quotation，只问订单时必须传 historyType=order，同时询问两类历史才使用 all。也适合报价前查看同客户、同型号或相近产品的历史价格。单纯按报价状态筛选当前报价列表时使用 search_quotations。',
            parameters: {
                type: 'object',
                properties: {
                    customerName: { type: 'string', description: '客户名称' },
                    customerId: { type: 'integer', minimum: 1, description: '客户ID，可选' },
                    keyword: { type: 'string', description: '型号/配方关键词，可选' },
                    recipeName: { type: 'string', description: '成品型号关键词，可选' },
                    model: { type: 'string', description: '型号关键词，可选' },
                    historyType: {
                        type: 'string',
                        enum: ['all', 'quotation', 'order'],
                        description: '历史范围：quotation=只返回报价，order=只返回订单，all=两者；默认 all'
                    },
                    limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多返回条数' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['customerName'] },
                    { type: 'object', properties: {}, required: ['customerId'] }
                ]
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'explain_cost_change',
            description: '按当日完整成本解释两个配方之间的差异，不写库。包含当前BOM、线圈、安装/打包工资、表面处理和管理费；任一配方缺价时明确失败。适合用户问“为什么12-140比12-120贵”“两个型号贵在哪里”。返回总差额和主要差异驱动项。',
            parameters: {
                type: 'object',
                properties: {
                    leftRecipeId: { type: 'number', description: '基准配方ID' },
                    leftRecipeName: { type: 'string', description: '基准成品型号' },
                    rightRecipeId: { type: 'number', description: '对比配方ID' },
                    rightRecipeName: { type: 'string', description: '对比成品型号' },
                    recipe1: { type: 'string', description: '基准成品型号兼容字段' },
                    recipe2: { type: 'string', description: '对比成品型号兼容字段' },
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
                    findingSnapshot: { type: 'object', additionalProperties: true, description: '本次提醒摘要，可选；必须原样来自最近一次正式检查结果' },
                    expectedUpdatedAt: { type: 'string', description: '最近一次智能检查返回的反馈 updatedAt；更新已有反馈时应传入' }
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
                    restoreNote: { type: 'string', description: '本次恢复说明，可选，最多500字' },
                    expectedUpdatedAt: { type: 'string', description: 'get_factory_rule_candidates 返回的当前规则 updatedAt；用于防止覆盖并发审核' }
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
                    reviewNote: { type: 'string', description: '审核说明，可选，最多500字' },
                    expectedUpdatedAt: { type: 'string', description: 'get_factory_rule_candidates 返回的当前规则 updatedAt；用于防止覆盖并发审核' }
                },
                required: ['candidateId', 'status']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_management_action_center',
            description: '实时读取个人管理助理的今日执行队列，汇总订单准备、经营风险、数据质量、规则学习和知识健康。progress 返回最近24小时自动归档、仍待处理、暂时受阻和反复出现的事项；同时返回最先处理的三项、排序依据、最短处理路径和完成标准。resolution.canAiConfirm=true 时只表示可继续读取最新订单处理方案并发起确认，不得直接宣称已执行。该工具只读，不创建任务、不修改业务数据。用户问“今天先处理什么”“处理了哪些”“现在最重要的待办”“工厂有哪些风险需要优先跟进”时使用。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'plan_factory_workflow',
            description: 'V8 统一执行计划：把订单生产准备、报价转订单或当前管理待办拆成按依赖排序的结构化步骤，明确自动检查、需要业务判断、需要确认、人工处理、等待和阻塞状态，并返回最近执行记录、失败原因、最新复查和可恢复步骤。工具本身只读。只有返回 canExecute=true 且带 confirmation 的步骤才表示已有安全执行器；恢复时还必须是 recovery.state=retry_available。canExecute=false 的确认步骤必须进入返回的业务页面处理。用户问“帮我规划处理流程”“一步步怎么做”“继续上次失败的操作”“把报价转订单后继续检查”“按顺序处理这些待办”时使用。',
            parameters: {
                type: 'object',
                properties: {
                    workflowType: {
                        type: 'string',
                        enum: ['order_readiness', 'quotation_to_order', 'management_action'],
                        description: '订单准备、报价转订单或管理待办'
                    },
                    goal: { type: 'string', description: '用户想完成的业务目标，可选' },
                    orderId: { type: 'number', description: 'order_readiness 必填的订单ID' },
                    quotationId: { type: 'number', description: 'quotation_to_order 必填的报价ID' },
                    actionId: { type: 'string', description: 'management_action 可选的稳定待办ID；不传时规划当前前三项' }
                },
                required: ['workflowType']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'execute_factory_workflow_step',
            description: '执行 V8 工厂执行计划中当前已解锁的跨模块写步骤。当前仅支持 quotation_to_order 的 convert_quotation：必须先在本轮调用 plan_factory_workflow，使用其返回的精确 quotationId/actionId；调用后显示确认卡片。用户确认时会重新生成实时计划、预检订单草稿、调用事务转单接口，并自动检查新订单生产准备。计划过期、报价未接受、已转单、资料不完整或步骤受阻时立即停止。',
            parameters: {
                type: 'object',
                properties: {
                    workflowType: {
                        type: 'string',
                        enum: ['quotation_to_order'],
                        description: '当前执行工作流类型'
                    },
                    quotationId: { type: 'number', description: '当前执行计划中的报价ID' },
                    actionId: {
                        type: 'string',
                        enum: ['convert_quotation'],
                        description: '当前计划中 status=available、canExecute=true 的步骤ID'
                    }
                },
                required: ['workflowType', 'quotationId', 'actionId']
            }
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
            description: '实时检查一个订单当前能否进入生产。按顺序核对订单状态、配方与BOM快照、零件库存、线圈库存、采购进度、锁定成本和销售单价，返回可生产、待补料、待复核、数据阻塞或不适用。只读，不修改订单和库存。已知 orderId 时可直接单次调用，无需先调用 get_order_detail；若还需要人工确认的客户要求和执行事实，服务端会在本能力成功后按同一订单目标自动补充知识包，模型不要改调其他能力。用户问“这个订单能不能生产”“是否齐料”“还缺什么”“生产准备情况”时使用。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'integer', minimum: 1, description: '订单ID，已知时优先使用' },
                    orderQuery: { type: 'string', description: '订单ID未知时可传客户名或合同号；匹配多条时会要求用户明确' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['orderId'] },
                    { type: 'object', properties: {}, required: ['orderQuery'] },
                ]
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'plan_order_readiness_actions',
            description: '根据订单实时生产准备检查结果生成按依赖排序的处理方案。区分AI可发起确认、人工补资料、采购跟进和等待状态；本工具会自行完成所需的准备检查，只生成方案，不执行写操作，无需先调用 check_order_readiness。若还需要人工确认的客户要求和执行事实，服务端会在本能力成功后按同一订单目标自动补充知识包，模型不要改调其他能力。用户问“这个订单的问题怎么处理”“给出处理方案”“下一步做什么”时使用。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'integer', minimum: 1, description: '订单ID，已知时优先使用' },
                    orderQuery: { type: 'string', description: '订单ID未知时可传客户名或合同号；匹配多条时会要求用户明确' }
                },
                anyOf: [
                    { type: 'object', properties: {}, required: ['orderId'] },
                    { type: 'object', properties: {}, required: ['orderQuery'] },
                ]
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
            name: 'save_order_requirement_draft',
            description: '把已经根据订单附件整理好的客户要求保存为可编辑草稿。仅保存草稿，不确认知识、不修改订单明细、配方、采购或库存。只能在用户明确要求保存草稿后调用，并且必须使用真实订单ID和附件上下文中的精确 fileId；需要用户确认卡片。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '客户要求所属订单ID' },
                    summaryText: { type: 'string', description: '忠于附件原文的客户要求摘要；缺失项和冲突项必须明确标注' },
                    sourceFileIds: {
                        type: 'array',
                        items: { type: 'number' },
                        description: '本摘要依据的订单附件 fileId；只能使用当前附件上下文中的精确ID'
                    }
                },
                required: ['orderId', 'summaryText']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'save_order_execution_draft',
            description: '把用户明确描述的订单执行事实保存为一条可编辑草稿。适用于生产前资源准备、生产中产能或供应商调整、过程异常，以及生产后质量、交付和客户反馈。仅保存草稿，不确认知识，不修改订单状态、配方、采购或库存；只能在用户明确要求保存后调用，并且需要确认卡片。',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '执行事实所属的真实订单ID' },
                    phase: {
                        type: 'string',
                        enum: ['pre_production', 'in_production', 'post_production'],
                        description: '发生阶段：生产前、生产中或生产后'
                    },
                    recordType: {
                        type: 'string',
                        enum: [
                            'resource_preparation',
                            'material_preparation',
                            'supplier_confirmation',
                            'capacity_adjustment',
                            'supplier_adjustment',
                            'process_exception',
                            'quality_check',
                            'quality_result',
                            'delivery_result',
                            'customer_feedback',
                            'other'
                        ],
                        description: '事实类型，必须与发生阶段相符'
                    },
                    title: { type: 'string', description: '简短标题；未提供时系统使用事实类型名称' },
                    summaryText: { type: 'string', description: '只记录实际发生、人工决定或已确认结果，不把建议和推断写成事实' },
                    occurredAt: { type: 'string', description: '事实发生时间，ISO 8601 格式；未提供时使用保存时间' },
                    sourceFileIds: {
                        type: 'array',
                        items: { type: 'number' },
                        description: '事实依据的订单附件 fileId，只能使用当前附件上下文中的精确ID'
                    }
                },
                required: ['orderId', 'phase', 'recordType', 'summaryText']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_factory_file_archive_targets',
            description: '为聊天附件查找可关联的真实业务资料对象，支持客户、报价、订单、配方、配方检查问题和AI回答问题。关联前必须先用本工具核对目标；返回多个候选时必须让用户选择，禁止猜测ID。只读。',
            parameters: {
                type: 'object',
                properties: {
                    targetType: {
                        type: 'string',
                        enum: ['customer', 'quotation', 'order', 'recipe', 'recipe_analysis_feedback', 'ai_answer_feedback'],
                        description: '业务资料关联目标类型'
                    },
                    query: { type: 'string', description: '客户名、合同号、成品型号、报价客户名或问题关键词，可为空以读取最近对象' },
                    limit: { type: 'number', description: '最多返回条数，默认20，最大50' }
                },
                required: ['targetType']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'archive_factory_file',
            description: '把聊天中已经上传的工厂文件正式关联到客户、报价、订单、配方或质量问题；知识库目标使用资料归档语义。只能使用附件上下文中的精确 fileId；业务对象必须先通过 search_factory_file_archive_targets 找到精确 targetId，不能猜测。归档到知识库时不传 targetId，由系统基于同一文件创建或复用知识资料。需要用户确认后执行。',
            parameters: {
                type: 'object',
                properties: {
                    fileId: { type: 'number', description: '附件上下文中的统一文件ID' },
                    targetType: {
                        type: 'string',
                        enum: ['customer', 'quotation', 'order', 'recipe', 'recipe_analysis_feedback', 'ai_answer_feedback', 'knowledge_document'],
                        description: '业务资料关联目标类型'
                    },
                    targetId: { type: 'number', description: '业务对象ID；归档到知识库时省略' },
                    title: { type: 'string', description: '归档标题，归档到知识库时建议明确填写' },
                    note: { type: 'string', description: '归档说明，可选' },
                    documentType: {
                        type: 'string',
                        enum: ['technical_note', 'pump_performance_test', 'drawing', 'spreadsheet', 'other'],
                        description: '知识资料类型，仅归档到知识库时使用'
                    },
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '知识资料标签，仅归档到知识库时使用'
                    }
                },
                required: ['fileId', 'targetType']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_business_changes',
            description: '查询订单、报价、采购、零件价格/库存、配方、泵壳模板、线圈和客户的正式业务变更历史。用户问“今天/最近有没有修改”“改了什么”“为什么改”“哪些业务发生过某类调整”时必须使用本工具，不能用管理行动中心、当前列表或知识快照代替。时间、数量和筛选结果来自结构化业务事件；semanticQuery 仅用于按含义寻找相关变更。只读。',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['today', 'yesterday', 'last7days', 'last30days', 'all'], description: '按北京时间查询的常用时间范围' },
                    from: { type: 'string', description: '自定义开始时间，ISO 8601；与 period 二选一' },
                    to: { type: 'string', description: '自定义结束时间，ISO 8601；与 period 二选一' },
                    domain: { type: 'string', enum: ['order', 'quotation', 'purchasing', 'part', 'recipe', 'template', 'coil', 'customer'], description: '业务域过滤' },
                    entityType: { type: 'string', enum: ['order', 'quotation', 'purchasing', 'part', 'recipe', 'template', 'coil', 'customer'], description: '关联对象类型过滤' },
                    entityId: { type: 'string', description: '关联对象 ID' },
                    eventType: { type: 'string', enum: ['created', 'updated', 'deleted', 'status_changed', 'inventory_changed', 'converted'], description: '变更类型' },
                    keyword: { type: 'string', description: '摘要、原因、字段名或对象名称的精确关键词' },
                    semanticQuery: { type: 'string', description: '按业务含义寻找相关变更，例如“不锈钢接轴相关调整”' },
                    limit: { type: 'number', description: '返回条数，默认20，最大100' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_factory_knowledge',
            description: '搜索工厂知识库中的业务规则、独立资料、已确认知识和历史快照，用于解释用途、兼容性、工厂约定或资料内容。若问题有零件、模板、配方、线圈、客户、报价、订单等正式实时 Query 能力，必须优先使用对应领域工具，禁止用知识快照代替当前价格、库存、状态、数量或正式列表。结果 evidenceLevel=semantic_candidate 或 matchMode=vector 只表示语义候选，不能单独证明用途、兼容性或专用配件关系；必须由标题、摘要、正文或 metadata 的明确文字证实后才能下结论。配方结果中的 Excel 是性能测试报告附件，不是图纸。独立资料使用 entryType=document；parserStatus=metadata_only 表示知识条目只能使用标题、说明和标签，不得把聊天附件的解析能力误认为该资料正文已进入知识库。只读。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '搜索关键词' },
                    entryType: { type: 'string', enum: ['part', 'template', 'recipe', 'coil', 'customer', 'quotation', 'order', 'quality_issue', 'business_rule', 'document', 'change_event'], description: '知识类型过滤，可选' },
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
            description: '读取某条工厂知识库条目的完整内容。通常先用 search_factory_knowledge 找到 id，再调用本工具。配方中的 .xls/.xlsx 附件若标记为 pump_performance_test，必须称为性能测试报告，不是图纸。独立资料 metadata.parserStatus=metadata_only 时只能说明文件存在及其人工填写信息；即使聊天直接上传的 PDF 已支持文字层解析，也不能据此推断该知识资料正文。',
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
            description: '按当日完整成本对比两个配方的BOM、工资、表面处理和管理费差异；costDiff 和明细 diff 均按“配方2减配方1”计算，正数表示配方2更贵。名称必须唯一匹配，缺价时明确失败。当用户说"对比V750和V550"时使用',
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
            description: '按关键词、物料类别或库存状态查询正式零件库。用户直接询问具体物料名称、类别、用途相关零件或专用配件（如电缆、电容、油封、机筒、轴承、密封件、切割泵壳/切割配件），即使没有说“零件”，也属于本能力；用途或专用关系结论还必须同时调用 search_factory_knowledge 检索 sourceTable=business_rules 的明确业务规则。名称类型不确定时可与 get_all_recipes、search_coils、search_templates 组合查证，保留各类型的正式身份。低库存按正式口径为库存大于0且不超过5。查询最贵/最便宜/库存最多/最少/最近更新等最值或排名问题时，必须设置 sortBy 与 sortOrder 并配合 limit（如 limit=1 或 5）取排序后的前 N 项，不得在未排序的列表中自行挑选最值。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: '搜索关键词（模糊匹配型号/名称）' },
                    category: { type: 'string', description: '按类别筛选（可选）' },
                    supplier: { type: 'string', description: '按供应商名称筛选（可选）' },
                    stockStatus: {
                        type: 'string',
                        enum: ['low', 'out', 'attention', 'ok'],
                        description: '库存状态：low=1到5，out=0或负数，attention=不超过5（含缺货），ok=大于5'
                    },
                    limit: { type: 'integer', minimum: 1, maximum: 100, description: '仅当用户明确要求最近或前 N 项，或配合 sortBy/sortOrder 取最值排名时传入' },
                    minPrice: { type: 'number', description: '最低目录成本价（可选）' },
                    maxPrice: { type: 'number', description: '最高目录成本价（可选）' },
                    priceBelow: { type: 'number', description: '目录成本价严格低于该值（可选）' },
                    priceAbove: { type: 'number', description: '目录成本价严格高于该值（可选）' },
                    minStock: { type: 'number', description: '最低库存（可选）' },
                    maxStock: { type: 'number', description: '最高库存（可选）' },
                    stockBelow: { type: 'number', description: '库存严格低于该值（可选）' },
                    stockAbove: { type: 'number', description: '库存严格高于该值（可选）' },
                    sortBy: {
                        type: 'string',
                        enum: ['price', 'stock', 'model', 'updatedAt'],
                        description: '排序字段：price=目录成本价，stock=库存，model=型号，updatedAt=最近更新时间。最值/排名问题必传'
                    },
                    sortOrder: {
                        type: 'string',
                        enum: ['asc', 'desc'],
                        description: '排序方向：asc=升序，desc=降序（默认 desc）。最贵/最多用 desc，最便宜/最少用 asc'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_part',
            description: '软删除一个明确零件。优先传正式 partId，并保留完整型号和供应商供用户核对；仅按型号调用时若存在多个同型号记录会停止并要求澄清。调用后必须显示正式删除预览确认卡片',
            parameters: {
                type: 'object',
                properties: {
                    partId: { type: 'integer', minimum: 1, description: '正式零件 ID（推荐；必须来自本轮正式查询）' },
                    model: { type: 'string', description: '要删除的完整零件型号' },
                    supplier: { type: 'string', description: '供应商；同型号存在多条时用于唯一绑定' }
                },
                required: ['model']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'batch_update_prices',
            description: '按类别或明确零件目标批量调整价格。当用户说"把所有轴承涨价10%"或指定一个/多个正式零件调价时使用；明确目标必须用partId，或同时提供完整型号和供应商',
            parameters: {
                type: 'object',
                oneOf: [
                    { type: 'object', properties: {}, required: ['category', 'percentChange'] },
                    { type: 'object', properties: {}, required: ['category', 'absoluteChange'] },
                    { type: 'object', properties: {}, required: ['targets', 'percentChange'] },
                    { type: 'object', properties: {}, required: ['targets', 'absoluteChange'] },
                ],
                properties: {
                    category: { type: 'string', minLength: 1, description: '零件类别' },
                    targets: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 8,
                        description: '明确零件目标，灰度阶段最多8项且确认卡会完整展示；每项只能使用partId，或同时提供完整型号和供应商',
                        items: {
                            type: 'object',
                            oneOf: [
                                { type: 'object', properties: {}, required: ['partId'] },
                                { type: 'object', properties: {}, required: ['model', 'supplier'] },
                            ],
                            properties: {
                                partId: { type: 'integer', minimum: 1, description: '从本轮正式零件查询取得的零件ID；服务端仍会重新回读确认' },
                                model: { type: 'string', minLength: 1, description: '数据库中的完整零件型号' },
                                supplier: { type: 'string', minLength: 1, description: '数据库中的完整供应商名称' },
                            },
                        },
                    },
                    percentChange: { type: 'number', description: '百分比变化（如10表示涨10%，-5表示降5%）' },
                    absoluteChange: { type: 'number', description: '绝对值变化（如2表示涨2元，-1表示降1元），与percentChange二选一' }
                }
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

// 写能力由统一能力注册表投影，禁止在工具文件内维护第二份名单。
const {
    assertAiToolRegistryComplete,
    writeCapabilityNames,
} = require('../../capabilities/registry.cjs');

assertAiToolRegistryComplete(AI_TOOLS);
const WRITE_TOOLS = new Set(writeCapabilityNames());


module.exports = { AI_TOOLS, COST_OVERRIDE_SCHEMA, WRITE_TOOLS };
