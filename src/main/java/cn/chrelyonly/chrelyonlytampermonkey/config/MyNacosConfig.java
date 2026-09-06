package cn.chrelyonly.chrelyonlytampermonkey.config;


import com.alibaba.nacos.api.NacosFactory;
import com.alibaba.nacos.api.PropertyKeyConst;
import com.alibaba.nacos.api.config.ConfigService;
import com.alibaba.nacos.api.exception.NacosException;
import com.alibaba.nacos.api.lock.LockService;
import com.alibaba.nacos.api.lock.NacosLockFactory;
import com.alibaba.nacos.api.naming.NamingService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;

import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

@Slf4j
public class MyNacosConfig {
    public static Properties init(String appName, String profile) throws NacosException {
        String serverAddr = "192.168.10.47:8848";
        Properties properties = new Properties();
// 指定Nacos-Server的地址
        properties.setProperty(PropertyKeyConst.SERVER_ADDR, serverAddr);
// 指定Nacos-SDK的命名空间
        properties.setProperty(PropertyKeyConst.NAMESPACE, appName);

// 初始化配置中心的Nacos Java SDK
        ConfigService configService = NacosFactory.createConfigService(properties);

// 初始化注册中心的Nacos Java SDK
        NamingService namingService = NacosFactory.createNamingService(properties);
        namingService.registerInstance(appName, appName, 8080);
// 初始化分布式锁的Nacos Java SDK
        LockService lockService = NacosLockFactory.createLockService(properties);

// 获取配置填充
        String application = configService.getConfig("application.yml", "DEFAULT_GROUP", 5000);
        String applicationDev = configService.getConfig("application-" + profile + ".yml", "DEFAULT_GROUP", 5000);

        // 💡 核心重点：构建资源数组列表
        List<Resource> resources = new ArrayList<>();

        // 1. 先添加通用基础配置 (application.yml)
        if (application != null && !application.trim().isEmpty()) {
            resources.add(new ByteArrayResource(application.getBytes()));
        }

        // 2. 再添加环境特定配置 (application-dev.yml)，同名 Key 会覆盖上一步的配置
        if (applicationDev != null && !applicationDev.trim().isEmpty()) {
            resources.add(new ByteArrayResource(applicationDev.getBytes()));
        }

        YamlPropertiesFactoryBean yamlFactory = new YamlPropertiesFactoryBean();
        // 💡 一次性传入 Resource 数组，YamlPropertiesFactoryBean 会按顺序进行合并
        yamlFactory.setResources(resources.toArray(new Resource[0]));

        Properties nacosProperties = yamlFactory.getObject();

        log.info("✅ Nacos 多 YAML 资源合并完成，共计合并 {} 个配置项",
                nacosProperties != null ? nacosProperties.size() : 0);

        return nacosProperties != null ? nacosProperties : new Properties();
    }
}
