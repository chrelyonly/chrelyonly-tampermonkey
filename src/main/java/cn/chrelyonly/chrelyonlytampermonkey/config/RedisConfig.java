package cn.chrelyonly.chrelyonlytampermonkey.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.serializer.JacksonJsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;


/**
 * @author chrelyonly
 * @version 2.1
 * 爱这个世界，爱世界上的所有人~
 * remark: 缓存配置
 * @description: TODO
 * @datetime 2022/6/17 15:03
 */
@Configuration
public class RedisConfig {
    private final String KEY_PREFIX = "chrelyonly-tampermonkey:";
    /**
     * 注册一个 string,object格式的redis模板
     */
    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory redisConnectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(redisConnectionFactory);

        JacksonJsonRedisSerializer<Object> jackson2JsonRedisSerializer = new JacksonJsonRedisSerializer<>(Object.class);
        template.setDefaultSerializer(jackson2JsonRedisSerializer);
        template.setKeySerializer(new StringRedisSerializer() {
            @Override
            public byte[] serialize(String key) {
                return super.serialize(KEY_PREFIX + key);
            }
        });

        return template;
    }

    /**
     * redis缓存器
     */
    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        return RedisCacheManager.create(connectionFactory);
    }

    /**
     * redis监听器
     */
    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(RedisConnectionFactory connectionFactory) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        return container;
    }
}
