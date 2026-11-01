package cn.chrelyonly.chrelyonlytampermonkey.controller;


import cn.chrelyonly.chrelyonlytampermonkey.component.R;
import cn.chrelyonly.chrelyonlytampermonkey.config.MyServerConfig;
import cn.hutool.core.util.StrUtil;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.micrometer.common.util.StringUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;

@RequestMapping("/orc-api")
@RestController
@Slf4j
@RequiredArgsConstructor
public class OrcController {

    @PostMapping("/getCode")
    public R getCode(@RequestBody JSONObject jsonObject){
        try (HttpResponse httpResponse = HttpRequest
                .post(MyServerConfig.SERVICE_ORC_API_URL + "/ocr/base64")
                .body(jsonObject.toJSONString())
                .execute()) {
            return R.data(JSONObject.parseObject(httpResponse.body()));
        }
    }
    private static final String CAPTCHA_RULE_KEY = "captcha:rules";

    private final StringRedisTemplate redisTemplate;
    /**
     * 获取指定 host 的验证码规则列表
     * GET /orc-api/getRules?host=example.com
     */
    @GetMapping("/getRules")
    public R getRules(@RequestParam("host") String host) {
        if (StringUtils.isBlank(host)) {
            return R.fail("host 参数不能为空");
        }

        // 从 Redis 获取规则 JSON 数组字符串
        Object ruleJsonStr = redisTemplate.opsForHash().get(CAPTCHA_RULE_KEY, host);
        if (ruleJsonStr == null) {
            return R.fail("未找到规则");
        }

        // 解析为 JSONArray 返回给前端
        JSONArray ruleList = JSONArray.parseArray(ruleJsonStr.toString());
        return R.data(ruleList);
    }
    @PostMapping("/saveRule")
    public R addRules(@RequestBody JSONObject jsonObject) {
        String host = jsonObject.getString("host");
        String img = jsonObject.getString("img");
        String input = jsonObject.getString("input");

        if (!StrUtil.isAllNotBlank(host, img, input)) {
            return R.fail("缺少必要参数：host, img, input");
        }

        // 1. 获取现有规则列表
        Object existingRuleStr = redisTemplate.opsForHash().get(CAPTCHA_RULE_KEY, host);
        JSONArray ruleArray = existingRuleStr != null
                ? JSONArray.parseArray(existingRuleStr.toString())
                : new JSONArray();

        // 2. 检查是否存在重复规则
        boolean isDuplicate = false;
        for (int i = 0; i < ruleArray.size(); i++) {
            JSONObject existingItem = ruleArray.getJSONObject(i);

            // 【策略 A】完全对比：如果所有属性均相同，视为重复
            // if (existingItem.equals(jsonObject)) { isDuplicate = true; break; }

            // 【策略 B】业务逻辑对比：如果 img 和 input 定位器完全一样，视为重复
            if (img.equals(existingItem.getString("img")) &&
                    input.equals(existingItem.getString("input"))) {

                // 可选：如果不希望忽略，而是用新传入的其他字段更新旧数据，可以在这里覆盖：
                // ruleArray.set(i, jsonObject);

                isDuplicate = true;
                break;
            }
        }

        // 3. 不重复时才追加并写入 Redis
        if (isDuplicate) {
            return R.success("规则已存在，自动过滤");
        }

        ruleArray.add(jsonObject);
        redisTemplate.opsForHash().put(CAPTCHA_RULE_KEY, host, ruleArray.toJSONString());

        return R.success("规则保存成功");
    }
    /**
     * 删除指定验证码规则
     * POST /orc-api/deleteRule
     *
     * 请求参数：
     * {
     *     "host": "example.com",
     *     "img": "#captcha",
     *     "input": "#captchaCode"
     * }
     */
    @PostMapping("/deleteRule")
    public R deleteRule(@RequestBody JSONObject jsonObject) {
        String host = jsonObject.getString("host");
        String img = jsonObject.getString("img");
        String input = jsonObject.getString("input");

        // 1. 参数校验
        if (!StrUtil.isAllNotBlank(host, img, input)) {
            return R.fail("缺少必要参数：host, img, input");
        }

        // 2. 获取当前域名的规则
        Object existingRuleStr = redisTemplate.opsForHash()
                .get(CAPTCHA_RULE_KEY, host);

        if (existingRuleStr == null) {
            return R.fail("当前域名不存在验证码规则");
        }

        // 3. 解析规则列表
        JSONArray ruleArray;
        try {
            ruleArray = JSONArray.parseArray(existingRuleStr.toString());
        } catch (Exception e) {
            log.error("验证码规则解析失败，host={}", host, e);
            return R.fail("规则数据解析失败");
        }

        // 4. 删除匹配的规则
        boolean removed = false;

        for (int i = ruleArray.size() - 1; i >= 0; i--) {
            JSONObject rule = ruleArray.getJSONObject(i);

            if (rule != null
                    && StrUtil.equals(img, rule.getString("img"))
                    && StrUtil.equals(input, rule.getString("input"))) {

                ruleArray.remove(i);
                removed = true;
            }
        }

        if (!removed) {
            return R.fail("未找到匹配的验证码规则");
        }

        // 5. 更新 Redis
        if (ruleArray.isEmpty()) {
            // 没有剩余规则，直接删除整个 host
            redisTemplate.opsForHash().delete(CAPTCHA_RULE_KEY, host);
        } else {
            // 还有剩余规则，更新规则列表
            redisTemplate.opsForHash().put(
                    CAPTCHA_RULE_KEY,
                    host,
                    ruleArray.toJSONString()
            );
        }

        log.info("验证码规则删除成功：host={}, img={}, input={}", host, img, input);

        return R.success("规则删除成功");
    }
}
